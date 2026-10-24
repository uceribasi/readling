import { dayKey, legacyTextId, type TextDoc, type WordEntry } from './db'
import { isQuizzable, isWeak } from './quiz'
import { countWords, findTermInText, tokenize, uniqueTerms, type Paragraph } from './tokenize'

export type StoryPractice = 'recent' | 'weak' | 'due'

export function isDue(word: WordEntry, now = Date.now()): boolean {
  return word.status === 'learning' && Boolean(word.card && new Date(word.card.due).getTime() <= now)
}

/** The same vocabulary selection is shared by stories, recommendations and daily practice. */
export function practiceWords(words: readonly WordEntry[], mode: StoryPractice, count = 10, now = Date.now()): WordEntry[] {
  return words
    .filter((word) => mode === 'recent' ? word.status === 'learning' : mode === 'due' ? isDue(word, now) : word.status !== 'ignored' && isWeak(word))
    .sort((a, b) => mode === 'due'
      ? new Date(a.card!.due).getTime() - new Date(b.card!.due).getTime()
      : mode === 'weak'
        ? (b.quiz!.wrong / (b.quiz!.correct + b.quiz!.wrong)) - (a.quiz!.wrong / (a.quiz!.correct + a.quiz!.wrong)) || b.updatedAt - a.updatedAt
        : b.createdAt - a.createdAt)
    .slice(0, Math.max(0, count))
}

/** Matches whole words and saved phrases, never substrings such as “art” inside “cart”. */
export function wordsInText(content: string, language: string, words: readonly WordEntry[]): WordEntry[] {
  const paragraphs = tokenize(content, language)
  return matchedWords(paragraphs, language, words)
}

function matchedWords(paragraphs: Paragraph[], language: string, words: readonly WordEntry[]): WordEntry[] {
  const terms = new Set(uniqueTerms(paragraphs))
  const sentences = paragraphs.flatMap((paragraph) => paragraph.sentences)
  return words.filter((word) => word.language === language && word.status !== 'ignored' && (
    word.term.includes(' ') ? sentences.some((sentence) => Boolean(findTermInText(sentence.text, word.term, language))) : terms.has(word.term)
  ))
}

/** Source encounters include PDF pages beyond the saved preview, retaining that text's meaning. */
export function wordsForText(text: TextDoc, words: readonly WordEntry[]): WordEntry[] {
  const sourceId = text.syncId ?? legacyTextId(text)
  const matched = new Set(wordsInText(text.content, text.language, words).map((word) => word.key))
  return words.filter((word) => word.language === text.language && word.status !== 'ignored').flatMap((word) => {
    const context = word.contexts?.filter((item) => item.source?.id === sourceId).sort((a, b) => b.seenAt - a.seenAt)[0]
    if (!context && !matched.has(word.key)) return []
    return [{ ...word, context: context?.sentence ?? word.context, translation: context?.translation ?? context?.explanation?.translation ?? word.translation, explanation: context?.explanation ?? word.explanation }]
  })
}

export interface TextRecommendation {
  text: TextDoc
  coverage: number
  practiceTerms: number
  wordCount: number
  score: number
}

/** Prefer approachable texts containing vocabulary that needs practice; PDFs only store a preview. */
export function recommendTexts(
  texts: readonly TextDoc[],
  words: readonly WordEntry[],
  options: { language?: string; now?: number; maxWords?: number } = {},
): TextRecommendation[] {
  const now = options.now ?? Date.now()
  const vocabularyByLanguage = new Map<string, Map<string, WordEntry>>()
  for (const word of words) {
    if (!vocabularyByLanguage.has(word.language)) vocabularyByLanguage.set(word.language, new Map())
    vocabularyByLanguage.get(word.language)!.set(word.term, word)
  }
  return texts.filter((text) => text.kind !== 'pdf' && text.content.trim() && (!options.language || text.language === options.language))
    .map((text) => {
      const paragraphs = tokenize(text.content, text.language)
      const terms = uniqueTerms(paragraphs)
      const vocabulary = vocabularyByLanguage.get(text.language) ?? new Map<string, WordEntry>()
      const known = terms.filter((term) => ['known', 'ignored'].includes(vocabulary.get(term)?.status ?? '')).length
      const coverage = terms.length ? known / terms.length : 0
      const practiceTerms = matchedWords(paragraphs, text.language, [...vocabulary.values()].filter((word) => isDue(word, now) || isWeak(word))).length
      const wordCount = text.wordCount ?? paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.reduce((n, sentence) => n + sentence.tokens.filter((token) => token.kind === 'word').length, 0), 0)
      const target = options.maxWords ?? 600
      const lengthPenalty = Math.max(0, wordCount - target) / Math.max(target, 1)
      const score = (1 - Math.abs(coverage - 0.8)) * 100 + Math.min(practiceTerms, 10) * 3 - Math.min(lengthPenalty, 4) * 15
      return { text, coverage, practiceTerms, wordCount, score }
    })
    .sort((a, b) => b.score - a.score || a.wordCount - b.wordCount || a.text.id - b.text.id)
}

export const DAILY_GOALS = [5, 10, 15] as const
export type DailyGoal = typeof DAILY_GOALS[number]
export type DailyStage = 'review' | 'read' | 'quiz' | 'done'
export interface DailyAnswer { key: string; correct: boolean }
export interface DailySession {
  date: string
  language: string
  goal: DailyGoal
  stage: DailyStage
  reviewKeys: string[]
  reviewedKeys: string[]
  textId?: number
  quizKeys: string[]
  answers: DailyAnswer[]
}

export function dailyLimits(goal: DailyGoal): { reviews: number; quiz: number; words: number } {
  return goal === 5 ? { reviews: 3, quiz: 2, words: 150 } : goal === 15 ? { reviews: 8, quiz: 5, words: 600 } : { reviews: 5, quiz: 3, words: 350 }
}

/** Keep a bounded passage for the daily reading, ending at a sentence when possible. */
export function dailyExcerpt(text: string, language: string, maxWords: number): string {
  const sentences = new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)
  const selected: string[] = []
  let count = 0
  for (const { segment } of sentences) {
    const sentence = segment.replace(/\s*\n\s*/g, ' ').trim()
    if (!sentence) continue
    const words = countWords(sentence, language)
    if (selected.length && count + words > maxWords) break
    if (!selected.length && words > maxWords * 1.5) {
      let taken = 0
      let excerpt = ''
      for (const token of new Intl.Segmenter(language, { granularity: 'word' }).segment(sentence)) {
        if (token.isWordLike && /\p{L}/u.test(token.segment) && ++taken > maxWords) break
        excerpt += token.segment
      }
      return excerpt.trim()
    }
    selected.push(sentence)
    count += words
    if (count >= maxWords) break
  }
  return selected.join(' ')
}

export function dailyQuizKeys(text: TextDoc | undefined, words: readonly WordEntry[], language: string, goal: DailyGoal = 10, now = Date.now()): string[] {
  const limits = dailyLimits(goal)
  const pool = words.filter((word) => word.language === language)
  const excerpt = text ? dailyExcerpt(text.content, language, limits.words) : ''
  const target = wordsInText(excerpt, language, text ? wordsForText(text, pool) : pool).filter(isQuizzable)
  const candidates = [...target, ...practiceWords(pool, 'weak', 10, now), ...practiceWords(pool, 'due', 10, now), ...pool]
  return [...new Map(candidates.filter((word) => word.status !== 'ignored' && isQuizzable(word)).map((word) => [word.key, word])).keys()].slice(0, limits.quiz)
}

export function createDailySession(texts: readonly TextDoc[], words: readonly WordEntry[], language: string, goal: DailyGoal = 10, now = Date.now()): DailySession {
  const limits = dailyLimits(goal)
  const pool = words.filter((word) => word.language === language)
  const text = recommendTexts(texts, pool, { language, now, maxWords: limits.words })[0]?.text
  const quizKeys = dailyQuizKeys(text, pool, language, goal, now)
  return { date: dayKey(now), language, goal, stage: 'review', reviewKeys: practiceWords(pool, 'due', limits.reviews, now).map((word) => word.key), reviewedKeys: [], textId: text?.id, quizKeys, answers: [] }
}

type DailyStorage = Pick<Storage, 'getItem' | 'setItem'>
const memory = new Map<string, string>()
const failedWrites = new Set<string>()
const memoryStorage: DailyStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) } }
function storage(): DailyStorage {
  try { return typeof localStorage === 'undefined' ? memoryStorage : localStorage } catch { return memoryStorage }
}
const sessionKey = (language: string, date: string) => `readling.daily.${date}.${encodeURIComponent(language)}`

export function parseDailySession(value: unknown, language: string, date: string): DailySession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  if (data.date !== date || data.language !== language || !DAILY_GOALS.includes(data.goal as DailyGoal) || !['review', 'read', 'quiz', 'done'].includes(data.stage as string)) return undefined
  const keys = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 20 && value.every((key) => typeof key === 'string' && key.startsWith(`${language}:`) && key.length <= 500) && new Set(value).size === value.length
  if (!keys(data.reviewKeys) || !keys(data.reviewedKeys) || !keys(data.quizKeys)) return undefined
  if (!data.reviewedKeys.every((key) => (data.reviewKeys as string[]).includes(key))) return undefined
  if (data.textId !== undefined && (!Number.isSafeInteger(data.textId) || (data.textId as number) <= 0)) return undefined
  if (!Array.isArray(data.answers) || data.answers.length > data.quizKeys.length) return undefined
  const answers: DailyAnswer[] = []
  for (const answer of data.answers) {
    if (!answer || typeof answer !== 'object' || typeof answer.correct !== 'boolean' || !(data.quizKeys as string[]).includes(answer.key) || answers.some((existing) => existing.key === answer.key)) return undefined
    answers.push({ key: answer.key, correct: answer.correct })
  }
  return { date, language, goal: data.goal as DailyGoal, stage: data.stage as DailyStage, reviewKeys: data.reviewKeys, reviewedKeys: data.reviewedKeys, textId: data.textId as number | undefined, quizKeys: data.quizKeys, answers }
}

export function loadDailySession(language: string, date = dayKey(), target: DailyStorage = storage()): DailySession | undefined {
  const key = sessionKey(language, date)
  try { return parseDailySession(JSON.parse((failedWrites.has(key) ? memoryStorage.getItem(key) : target.getItem(key)) ?? 'null'), language, date) } catch {
    try { return parseDailySession(JSON.parse(memoryStorage.getItem(key) ?? 'null'), language, date) } catch { return undefined }
  }
}
export function saveDailySession(session: DailySession, target: DailyStorage = storage()): void {
  const key = sessionKey(session.language, session.date)
  const value = JSON.stringify(session)
  memoryStorage.setItem(key, value)
  try { target.setItem(key, value); failedWrites.delete(key) } catch { failedWrites.add(key) }
}
export function loadDailyGoal(target: DailyStorage = storage()): DailyGoal {
  try { const value = Number(target.getItem('readling.daily.goal')); return DAILY_GOALS.includes(value as DailyGoal) ? value as DailyGoal : 10 } catch { return 10 }
}
export function saveDailyGoal(goal: DailyGoal, target: DailyStorage = storage()): void {
  try { target.setItem('readling.daily.goal', String(goal)) } catch { /* The current session still retains its goal. */ }
}
