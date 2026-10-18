import type { WordEntry } from './db'
import { tokenize, uniqueTerms } from './tokenize'

export interface TextProgress {
  known: number
  learning: number
  total: number
}

export type Difficulty = 'easy' | 'good' | 'challenging' | 'hard'

/** Below this many known words in a language, every text looks hard, so no label is shown. */
export const MIN_KNOWN_FOR_DIFFICULTY = 100

/** Counts a text's unique words by status. Ignored words (names and such) count as known. */
export function measureText(content: string, language: string, wordMap: Map<string, Pick<WordEntry, 'status'>>): TextProgress {
  const terms = uniqueTerms(tokenize(content, language))
  return measureTerms(terms, wordMap)
}

/** Recount cached terms when vocabulary changes, without segmenting a book again. */
export function measureTerms(terms: readonly string[], wordMap: Map<string, Pick<WordEntry, 'status'>>): TextProgress {
  const progress = { known: 0, learning: 0, total: terms.length }
  for (const term of terms) {
    const status = wordMap.get(term)?.status
    if (status === 'learning') progress.learning++
    else if (status) progress.known++
  }
  return progress
}

/** Share of a text's unique words not known yet, from 0 to 1. */
export function unknownShare(progress: TextProgress): number {
  return progress.total ? (progress.total - progress.known) / progress.total : 0
}

/**
 * How hard a text is for this reader, from the share of unique words they don't know.
 * Around 10–25% new words is the usual sweet spot for learning from reading.
 */
export function difficultyOf(progress: TextProgress): Difficulty {
  const share = unknownShare(progress)
  if (share <= 0.1) return 'easy'
  if (share <= 0.25) return 'good'
  if (share <= 0.4) return 'challenging'
  return 'hard'
}
