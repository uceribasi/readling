import type { WordEntry } from './db'
import { findTermInText, normalizeTerm } from './tokenize'
import { displayTerm } from './phrases'

export type QuizScope = 'learning' | 'known' | 'weak' | 'all'

export type Question =
  /** Word → pick its translation. */
  | { kind: 'meaning'; word: WordEntry; options: string[]; answer: string }
  /** Translation → pick the word. */
  | { kind: 'reverse'; word: WordEntry; options: string[]; answer: string }
  /** Sentence with the word blanked out → pick or type it. */
  | { kind: 'cloze'; word: WordEntry; before: string; after: string; options?: string[]; answer: string }
  /** Translation → type the word. */
  | { kind: 'typing'; word: WordEntry; answer: string; accepted: string[] }

export type QuestionKind = Question['kind']

const CHOICES = 4

/** A word is weak once a test has caught it out and it's right less than 70% of the time. */
export function isWeak(word: WordEntry): boolean {
  const stats = word.quiz
  if (!stats || stats.wrong === 0) return false
  return stats.correct / (stats.correct + stats.wrong) < 0.7
}

export function inScope(word: WordEntry, scope: QuizScope): boolean {
  if (word.status === 'ignored') return false
  if (scope === 'weak') return isWeak(word)
  return scope === 'all' || word.status === scope
}

/** Splits the context around the word, preserving its original spelling and vowel marks. */
export function clozeParts(word: WordEntry): { before: string; after: string; surface: string } | undefined {
  if (!word.context) return undefined
  const match = findTermInText(word.context, word.term, word.language)
  if (!match) return undefined
  return {
    before: word.context.slice(0, match.start),
    after: word.context.slice(match.end),
    surface: word.context.slice(match.start, match.end),
  }
}

/** True if the word has enough saved information for at least one question type. */
export function isQuizzable(word: WordEntry): boolean {
  return Boolean(word.translation) || Boolean(clozeParts(word))
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function normalize(text: string): string {
  return text.trim().toLocaleLowerCase()
}

/**
 * Picks wrong answers, preferring words with the same part of speech so the
 * options are plausible, e.g. nouns against nouns.
 */
function distractors(
  word: WordEntry,
  pool: WordEntry[],
  value: (candidate: WordEntry) => string | undefined,
  random: () => number,
): string[] | undefined {
  const correct = normalize(value(word) ?? '')
  const seen = new Set([correct])
  const candidates: { text: string; samePos: boolean }[] = []
  for (const candidate of shuffle(pool, random)) {
    const text = value(candidate)
    if (!text || candidate.key === word.key || seen.has(normalize(text))) continue
    seen.add(normalize(text))
    const pos = word.explanation?.partOfSpeech
    candidates.push({ text, samePos: Boolean(pos) && candidate.explanation?.partOfSpeech === pos })
  }
  if (candidates.length < CHOICES - 1) return undefined
  candidates.sort((a, b) => Number(b.samePos) - Number(a.samePos))
  return candidates.slice(0, CHOICES - 1).map((candidate) => candidate.text)
}

function withAnswer(answer: string, wrong: string[], random: () => number): string[] {
  return shuffle([answer, ...wrong], random)
}

/**
 * Builds a mixed test. `pool` is every word of the language (used for wrong
 * options); `targets` are the words to ask about.
 */
export function buildQuiz(
  targets: WordEntry[],
  pool: WordEntry[],
  count: number,
  random: () => number = Math.random,
): Question[] {
  const questions: Question[] = []
  for (const word of shuffle(targets.filter(isQuizzable), random).slice(0, count)) {
    const options: (() => Question | undefined)[] = []
    const translation = word.translation
    const term = displayTerm(word.term, word.language)

    if (translation) {
      options.push(() => {
        const wrong = distractors(word, pool, (candidate) => candidate.translation, random)
        return wrong && { kind: 'meaning', word, options: withAnswer(translation, wrong, random), answer: translation }
      })
      options.push(() => {
        const wrong = distractors(word, pool, (candidate) => (candidate.translation ? displayTerm(candidate.term, candidate.language) : undefined), random)
        return wrong && { kind: 'reverse', word, options: withAnswer(term, wrong, random), answer: term }
      })
      options.push(() => {
        const accepted = [term, word.explanation?.lemma].filter((value): value is string => Boolean(value))
        return { kind: 'typing', word, answer: term, accepted }
      })
    }

    const cloze = clozeParts(word)
    if (cloze) {
      options.push(() => {
        const wrong = distractors(word, pool, (candidate) => displayTerm(candidate.term, candidate.language), random)
        return {
          kind: 'cloze',
          word,
          before: cloze.before,
          after: cloze.after,
          options: wrong && withAnswer(term, wrong, random),
          answer: term,
        }
      })
    }

    // Try question types in random order until one has enough material.
    for (const make of shuffle(options, random)) {
      const question = make()
      if (question) {
        questions.push(question)
        break
      }
    }
  }
  return questions
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[b.length]
}

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

export type TypedVerdict = 'correct' | 'close' | 'wrong'

/**
 * Checks a typed answer. Missing accents or one typo in a longer word count as
 * "close", which is scored as correct but shown to the learner.
 */
export function checkTyped(input: string, accepted: string[], language: string): TypedVerdict {
  const given = normalizeTerm(input.trim(), language)
  if (!given) return 'wrong'
  let verdict: TypedVerdict = 'wrong'
  for (const option of accepted) {
    const expected = normalizeTerm(option.trim(), language)
    if (given === expected) return 'correct'
    if (stripAccents(given) === stripAccents(expected)) verdict = 'close'
    else if (expected.length >= 5 && editDistance(given, expected) <= 1) verdict = 'close'
  }
  return verdict
}
