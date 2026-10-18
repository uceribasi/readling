import Dexie, { type EntityTable } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { Explanation } from './ai/types'
import { measureText } from './difficulty'
import { newCard } from './srs'
import { countWords } from './tokenize'

export interface TextDoc {
  id: number
  title: string
  language: string
  /** Full text for pasted texts; a short preview for PDFs. */
  content: string
  /** Missing on texts saved before PDFs were supported. */
  kind?: 'text' | 'pdf'
  /** For PDFs: the original file in the `files` table. */
  fileId?: string
  pageCount?: number
  /** Stored at save time so the library doesn't re-segment long texts. */
  wordCount?: number
  /** Page the reader was on, so reopening a long text continues there. */
  readingPage?: number
  /** Legacy progress snapshot; the library derives current progress from vocabulary. */
  progress?: { known: number; learning: number; total: number }
  /** Where the text came from, e.g. a Wikipedia article or a web page. */
  sourceUrl?: string
  createdAt: number
  updatedAt: number
  lastOpenedAt?: number
}

export interface StoredFile {
  id: string
  name: string
  type: string
  blob: Blob
  createdAt: number
}

export type WordStatus = 'learning' | 'known' | 'ignored'

export interface WordEntry {
  /** `${language}:${term}` */
  key: string
  language: string
  /** Normalized (lowercased) form of the word. */
  term: string
  status: WordStatus
  translation?: string
  /** Sentence paired with the saved explanation; shown on review cards. */
  context?: string
  explanation?: Explanation
  /** FSRS scheduling state; only present while the word is being learned. */
  card?: Card
  /** Practice-test results. Tests never change the FSRS schedule. */
  quiz?: QuizStats
  createdAt: number
  updatedAt: number
}

export interface QuizStats {
  correct: number
  wrong: number
  lastAt: number
}

/** What was done on one day (local time), for streaks and stats. */
export interface DayActivity {
  /** YYYY-MM-DD */
  date: string
  wordsRead: number
  /** Words met for the first time (clicked, or marked known by finishing a page). */
  wordsAdded: number
  reviews: number
  quiz: number
}

export interface CachedTranslation {
  /** `${language}|${target}|${sentence}` */
  key: string
  text: string
  createdAt: number
}

export interface CachedExplanation {
  key: string
  data: Explanation
  createdAt: number
}

export const db = new Dexie('readling') as Dexie & {
  texts: EntityTable<TextDoc, 'id'>
  words: EntityTable<WordEntry, 'key'>
  explanations: EntityTable<CachedExplanation, 'key'>
  files: EntityTable<StoredFile, 'id'>
  activity: EntityTable<DayActivity, 'date'>
  translations: EntityTable<CachedTranslation, 'key'>
}

db.version(1).stores({
  texts: '++id, language, updatedAt',
  words: 'key, language, status',
  explanations: 'key',
})

db.version(2).stores({
  files: 'id',
})

db.version(3).stores({
  activity: 'date',
})

db.version(4).stores({
  translations: 'key',
})

/** A random id; crypto.randomUUID only exists on https/localhost, so fall back elsewhere (e.g. a LAN IP). */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Deletes a text together with its PDF file, if it has one. */
/** Saves a plain text with its word count and how much of it is known already, for the library card. */
export async function addText(doc: { title: string; language: string; content: string; sourceUrl?: string }): Promise<number> {
  const words = await db.words.where('language').equals(doc.language).toArray()
  const progress = measureText(doc.content, doc.language, new Map(words.map((word) => [word.term, word])))
  const now = Date.now()
  return db.texts.add({
    ...doc,
    kind: 'text',
    wordCount: countWords(doc.content, doc.language),
    progress,
    createdAt: now,
    updatedAt: now,
  })
}

export async function deleteText(text: TextDoc): Promise<void> {
  await db.transaction('rw', db.texts, db.files, async () => {
    await db.texts.delete(text.id)
    if (text.fileId) await db.files.delete(text.fileId)
  })
}

export function wordKey(language: string, term: string): string {
  return `${language}:${term}`
}

export async function setWordStatus(
  language: string,
  term: string,
  status: WordStatus,
  context?: string,
): Promise<void> {
  const key = wordKey(language, term)
  const now = Date.now()
  const added = await db.transaction('rw', db.words, async () => {
    const existing = await db.words.get(key)
    // Only words being learned are scheduled for review.
    const card = status === 'learning' ? (existing?.card ?? newCard()) : undefined
    if (existing) {
      await db.words.put({ ...existing, status, card, context: existing.context ?? context, updatedAt: now })
      return false
    }
    await db.words.add({ key, language, term, status, context, card, createdAt: now, updatedAt: now })
    return true
  })
  if (added) await recordActivity({ wordsAdded: 1 })
}

/** Puts a word back exactly as it was, e.g. to undo a review. */
export async function restoreWord(word: WordEntry): Promise<void> {
  await db.words.put(word)
}

export async function deleteWord(key: string): Promise<void> {
  await db.words.delete(key)
}

export async function recordQuizAnswer(key: string, correct: boolean): Promise<void> {
  await db.transaction('rw', db.words, async () => {
    const word = await db.words.get(key)
    if (!word) return
    const stats = word.quiz ?? { correct: 0, wrong: 0, lastAt: 0 }
    const quiz = {
      correct: stats.correct + (correct ? 1 : 0),
      wrong: stats.wrong + (correct ? 0 : 1),
      lastAt: Date.now(),
    }
    await db.words.update(key, { quiz, updatedAt: quiz.lastAt })
  })
  await recordActivity({ quiz: 1 })
}

/** Puts words back into the review queue, due right away (e.g. the ones missed in a test). */
export async function queueForReview(keys: string[]): Promise<void> {
  const now = new Date()
  await db.transaction('rw', db.words, async () => {
    for (const word of await db.words.bulkGet(keys)) {
      if (!word) continue
      const card = word.card ? { ...word.card, due: now } : newCard(now)
      await db.words.put({ ...word, status: 'learning', card, updatedAt: now.getTime() })
    }
  })
}

export async function saveReviewedCard(key: string, card: Card): Promise<void> {
  await db.words.update(key, { card, updatedAt: Date.now() })
  await recordActivity({ reviews: 1 })
}

/** The local calendar day of a moment, as YYYY-MM-DD. */
export function dayKey(time: number | Date = Date.now()): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export async function recordActivity(change: Partial<Omit<DayActivity, 'date'>>): Promise<void> {
  const date = dayKey()
  await db.transaction('rw', db.activity, async () => {
    const day = (await db.activity.get(date)) ?? { date, wordsRead: 0, wordsAdded: 0, reviews: 0, quiz: 0 }
    await db.activity.put({
      date,
      wordsRead: day.wordsRead + (change.wordsRead ?? 0),
      wordsAdded: (day.wordsAdded ?? 0) + (change.wordsAdded ?? 0),
      reviews: day.reviews + (change.reviews ?? 0),
      quiz: day.quiz + (change.quiz ?? 0),
    })
  })
}

// Pages already counted in this session, so paging back and forth doesn't inflate "words read".
const pagesRead = new Set<string>()

/** Counts a finished page towards today's words read, once per page per session. */
export async function recordPageRead(textId: number, page: number, words: number): Promise<void> {
  const key = `${textId}:${page}`
  if (pagesRead.has(key) || words <= 0) return
  pagesRead.add(key)
  await recordActivity({ wordsRead: words })
}

export async function saveExplanation(language: string, term: string, explanation: Explanation, context: string): Promise<void> {
  await db.words.update(wordKey(language, term), {
    context,
    translation: explanation.translation,
    explanation,
    updatedAt: Date.now(),
  })
}

/** Marks words that have never been tracked as known (LingQ's "finish page"). */
export async function markUntrackedAsKnown(language: string, terms: string[]): Promise<void> {
  const now = Date.now()
  const added = await db.transaction('rw', db.words, async () => {
    const keys = terms.map((term) => wordKey(language, term))
    const existing = await db.words.bulkGet(keys)
    const fresh = terms
      .filter((_, index) => !existing[index])
      .map((term) => ({
        key: wordKey(language, term),
        language,
        term,
        status: 'known' as const,
        createdAt: now,
        updatedAt: now,
      }))
    await db.words.bulkAdd(fresh)
    return fresh.length
  })
  if (added) await recordActivity({ wordsAdded: added })
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
