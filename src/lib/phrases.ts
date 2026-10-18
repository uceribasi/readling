/**
 * Multi-word phrases ("give up", "a pesar de") are saved like words. Their term is the
 * words' terms joined by single spaces, in every language, so they never clash with a word.
 */
import { NO_SPACE_LANGUAGES } from './languages'

export const MAX_PHRASE_WORDS = 8

export function phraseTerm(terms: string[]): string {
  return terms.join(' ')
}

export function isPhrase(term: string): boolean {
  return term.includes(' ')
}

/** How a saved term reads: phrases in languages without spaces lose the separators. */
export function displayTerm(term: string, language: string): string {
  return isPhrase(term) && NO_SPACE_LANGUAGES.has(language) ? term.replaceAll(' ', '') : term
}

/** Phrases by their first word, longest first, so the longest match wins. */
export type PhraseIndex = ReadonlyMap<string, string[][]>

export function buildPhraseIndex(terms: Iterable<string>): PhraseIndex {
  const index = new Map<string, string[][]>()
  for (const term of terms) {
    if (!isPhrase(term)) continue
    const words = term.split(' ')
    const list = index.get(words[0]) ?? []
    list.push(words)
    index.set(words[0], list)
  }
  for (const list of index.values()) list.sort((a, b) => b.length - a.length)
  return index
}

export interface PhraseMatch {
  /** Positions in the word list, inclusive. */
  start: number
  end: number
  term: string
}

/** Finds saved phrases in a sentence's words, left to right, without overlaps. */
export function findPhrases(
  words: readonly string[],
  index: PhraseIndex,
  canJoin: (left: number, right: number) => boolean = () => true,
): PhraseMatch[] {
  const matches: PhraseMatch[] = []
  if (!index.size) return matches
  for (let i = 0; i < words.length; i++) {
    const phrase = index.get(words[i])?.find((candidate) =>
      candidate.every((term, k) => words[i + k] === term && (k === 0 || canJoin(i + k - 1, i + k))),
    )
    if (!phrase) continue
    matches.push({ start: i, end: i + phrase.length - 1, term: phraseTerm(phrase) })
    i += phrase.length - 1
  }
  return matches
}

/** Keep punctuation and paragraph boundaries when matching words from a text or PDF layer. */
export function findTextPhrases(
  text: string,
  words: readonly { term: string; start: number; end: number }[],
  index: PhraseIndex,
): PhraseMatch[] {
  return findPhrases(words.map((word) => word.term), index, (left, right) => {
    const gap = text.slice(words[left].end, words[right].start)
    return /^\s*$/u.test(gap) && !/\n\s*\n/u.test(gap)
  })
}
