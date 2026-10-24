import Dexie, { type EntityTable } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { Explanation } from './ai/types'
import { measureText } from './difficulty'
import { newCard } from './srs'
import { countWords } from './tokenize'

export interface TextDoc {
  id: number
  /** Stable across devices; numeric ids remain local routing ids. */
  syncId?: string
  collection?: string
  readingStatus?: 'unread' | 'reading' | 'finished'
  chapters?: { title: string; start: number }[]
  bookmarks?: { id: string; page: number; label: string; note: string; createdAt: number; updatedAt?: number }[]
  bookmarkDeletions?: { id: string; deletedAt: number }[]
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

export interface WordSource { id: string; title: string; url?: string; page?: number }
export interface WordContext {
  id: string
  sentence: string
  translation?: string
  explanation?: Explanation
  source?: WordSource
  seenAt: number
  updatedAt?: number
}

export interface Tombstone { key: string; updatedAt: number }

export interface WordEntry {
  /** `${language}:${term}` */
  key: string
  language: string
  /** Normalized (lowercased) form of the word. */
  term: string
  status: WordStatus
  /** Last explicit status decision, independent of encounters, explanations and practice. */
  statusAt?: number
  translation?: string
  /** Sentence paired with the saved explanation; shown on review cards. */
  context?: string
  explanation?: Explanation
  contexts?: WordContext[]
  /** Explicit family override; forms keep independent review schedules. */
  family?: string
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
  tombstones: EntityTable<Tombstone, 'key'>
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

db.version(5).stores({ texts: '++id, language, updatedAt, syncId', tombstones: 'key' }).upgrade(async (tx) => {
  await tx.table('texts').toCollection().modify((text: TextDoc) => { text.syncId ??= legacyTextId(text) })
})

/** Deterministic identity for the same pre-sync document on different devices. */
export function legacyTextId(text: Pick<TextDoc, 'createdAt' | 'title' | 'language' | 'content'>): string {
  let a = 2166136261
  let b = 5381
  for (const char of `${text.language}\n${text.title}\n${text.content}`) {
    a = Math.imul(a ^ char.charCodeAt(0), 16777619)
    b = Math.imul(b, 33) ^ char.charCodeAt(0)
  }
  return `legacy-${text.createdAt}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`
}

/** A random id; crypto.randomUUID only exists on https/localhost, so fall back elsewhere (e.g. a LAN IP). */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Deletes a text together with its PDF file, if it has one. */
/** Saves a plain text with its word count and how much of it is known already, for the library card. */
export async function addText(doc: { title: string; language: string; content: string; sourceUrl?: string; chapters?: TextDoc['chapters'] }): Promise<number> {
  const words = await db.words.where('language').equals(doc.language).toArray()
  const progress = measureText(doc.content, doc.language, new Map(words.map((word) => [word.term, word])))
  const now = Date.now()
  return db.texts.add({
    ...doc,
    syncId: newId(),
    kind: 'text',
    wordCount: countWords(doc.content, doc.language),
    progress,
    createdAt: now,
    updatedAt: now,
  })
}

export async function deleteText(text: TextDoc): Promise<void> {
  await db.transaction('rw', db.texts, db.files, db.tombstones, async () => {
    await db.tombstones.put({ key: `text:${text.syncId ?? legacyTextId(text)}`, updatedAt: Date.now() })
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
  const added = await db.transaction('rw', db.words, db.tombstones, async () => {
    const existing = await db.words.get(key)
    const deletion = await db.tombstones.get(`word:${key}`)
    // A deliberate re-add must sort after a deletion, even in the same clock tick.
    const editedAt = Math.max(now, (existing?.updatedAt ?? -1) + 1, (existing?.statusAt ?? -1) + 1, (deletion?.updatedAt ?? -1) + 1)
    // Only words being learned are scheduled for review.
    const card = status === 'learning' ? (existing?.card ?? newCard()) : undefined
    if (existing) {
      await db.words.put({ ...existing, status, statusAt: editedAt, card, context: existing.context ?? context, updatedAt: editedAt })
      return false
    }
    await db.words.add({ key, language, term, status, statusAt: editedAt, context, card, createdAt: now, updatedAt: editedAt })
    return true
  })
  if (added) await recordActivity({ wordsAdded: 1 })
}

/** Puts a word back exactly as it was, e.g. to undo a review. */
export async function restoreWord(word: WordEntry): Promise<void> {
  await db.words.put(word)
}

export async function deleteWord(key: string): Promise<void> {
  await db.transaction('rw', db.words, db.tombstones, async () => {
    const word = await db.words.get(key)
    const previous = await db.tombstones.get(`word:${key}`)
    await db.tombstones.put({ key: `word:${key}`, updatedAt: Math.max(Date.now(), (word?.updatedAt ?? -1) + 1, (previous?.updatedAt ?? -1) + 1) })
    await db.words.delete(key)
  })
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
    await db.words.update(key, { quiz, statusAt: word.statusAt ?? word.updatedAt, updatedAt: Math.max(quiz.lastAt, word.updatedAt) })
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
      const editedAt = Math.max(now.getTime(), word.updatedAt + 1, (word.statusAt ?? -1) + 1)
      await db.words.put({ ...word, status: 'learning', statusAt: editedAt, card, updatedAt: editedAt })
    }
  })
}

export async function saveReviewedCard(key: string, card: Card): Promise<void> {
  const reviewed = await db.transaction('rw', db.words, async () => {
    const word = await db.words.get(key)
    if (!word || word.status !== 'learning') return false
    await db.words.update(key, { card, statusAt: word.statusAt ?? word.updatedAt, updatedAt: Math.max(Date.now(), word.updatedAt) })
    return true
  })
  if (reviewed) await recordActivity({ reviews: 1 })
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

export async function saveExplanation(language: string, term: string, explanation: Explanation, context: string, source?: WordSource): Promise<void> {
  await db.transaction('rw', db.words, async () => {
    const word = await db.words.get(wordKey(language, term))
    if (!word) return
    const contexts = appendContext(word, context, explanation, source)
    await db.words.update(word.key, { context, translation: explanation.translation, explanation, contexts, statusAt: word.statusAt ?? word.updatedAt, updatedAt: Math.max(Date.now(), word.updatedAt) })
  })
}

export function appendContext(word: WordEntry, sentence: string, explanation?: Explanation, source?: WordSource): WordContext[] {
  const contexts = [...(word.contexts ?? [])]
  if (word.context && !contexts.some((item) => item.sentence === word.context)) {
    contexts.push({ id: newId(), sentence: word.context, explanation: word.explanation, translation: word.translation, seenAt: word.createdAt })
  }
  if (!sentence.trim()) return contexts
  const index = contexts.findIndex((item) => item.sentence === sentence && (!source || !item.source || item.source.id === source.id))
  const old = contexts[index]
  const item: WordContext = { ...old, id: old?.id ?? newId(), sentence, explanation: explanation ?? old?.explanation, translation: explanation?.translation ?? old?.translation, source: source ?? old?.source, seenAt: old?.seenAt ?? Date.now() }
  if (!old || JSON.stringify(item) !== JSON.stringify(old)) item.updatedAt = Date.now()
  if (index < 0) contexts.push(item)
  else contexts[index] = item
  return contexts
}

export async function rememberContext(language: string, term: string, sentence: string, source?: WordSource): Promise<void> {
  await db.transaction('rw', db.words, async () => {
    const word = await db.words.get(wordKey(language, term))
    if (!word) return
    const contexts = appendContext(word, sentence, word.context === sentence ? word.explanation : undefined, source)
    if (JSON.stringify(contexts) !== JSON.stringify(word.contexts)) await db.words.update(word.key, { contexts, statusAt: word.statusAt ?? word.updatedAt, updatedAt: Math.max(Date.now(), word.updatedAt) })
  })
}

/** Marks words that have never been tracked as known (LingQ's "finish page"). */
export async function markUntrackedAsKnown(language: string, terms: string[]): Promise<void> {
  const now = Date.now()
  const added = await db.transaction('rw', db.words, db.tombstones, async () => {
    const keys = terms.map((term) => wordKey(language, term))
    const existing = await db.words.bulkGet(keys)
    const deletions = await db.tombstones.bulkGet(keys.map((key) => `word:${key}`))
    const fresh = terms.flatMap((term, index) => {
      if (existing[index]) return []
      const editedAt = Math.max(now, (deletions[index]?.updatedAt ?? -1) + 1)
      return [{
        key: keys[index],
        language,
        term,
        status: 'known' as const,
        statusAt: editedAt,
        createdAt: now,
        updatedAt: editedAt,
      }]
    })
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
