import { NO_SPACE_LANGUAGES } from './languages'

export type Token = { kind: 'word'; text: string; term: string } | { kind: 'text'; text: string }

export interface Sentence {
  text: string
  tokens: Token[]
}

export interface Paragraph {
  sentences: Sentence[]
}

export interface WordPosition {
  paragraph: number
  sentence: number
  token: number
}

const LETTER = /\p{L}/u

/**
 * Vowel signs that are usually left out (Arabic harakat and tatweel, Hebrew niqqud), so a
 * vowelled and an unvowelled spelling count as the same word.
 */
const OPTIONAL_MARKS: Record<string, RegExp> = {
  ar: /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g,
  fa: /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g,
  he: /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g,
}

export function normalizeTerm(word: string, language: string): string {
  const term = word.toLocaleLowerCase(language).replace(/[’‘]/g, "'")
  const marks = OPTIONAL_MARKS[language]
  return marks ? term.replace(marks, '') : term
}

/** Match a normalized term while retaining the original spelling and all its vowel marks. */
export function findTermInText(text: string, term: string, language: string): { start: number; end: number } | undefined {
  const offsets: { start: number; end: number }[] = []
  for (const { segment, index } of new Intl.Segmenter(language, { granularity: 'grapheme' }).segment(text)) {
    for (let i = 0; i < normalizeTerm(segment, language).length; i++) {
      offsets.push({ start: index, end: index + segment.length })
    }
  }
  const spaced = !NO_SPACE_LANGUAGES.has(language)
  const body = normalizeTerm(term, language).split(' ')
    .map((part) => part.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&'))
    .join(spaced ? '\\s+' : '')
  if (!body) return undefined
  const pattern = new RegExp(spaced ? '(?<![\\p{L}\\p{N}\\p{M}])' + body + '(?![\\p{L}\\p{N}\\p{M}])' : body, 'u')
  const match = pattern.exec(normalizeTerm(text, language))
  if (!match) return undefined
  return { start: offsets[match.index].start, end: offsets[match.index + match[0].length - 1].end }
}

/**
 * Splits a text into paragraphs, sentences and word tokens using the browser's
 * Intl.Segmenter, which also handles languages without spaces (ja, zh).
 * Blank lines separate paragraphs; single line breaks are treated as spaces.
 */
export function tokenize(content: string, language: string): Paragraph[] {
  const sentenceSegmenter = new Intl.Segmenter(language, { granularity: 'sentence' })
  const wordSegmenter = new Intl.Segmenter(language, { granularity: 'word' })

  return content
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((block) => ({
      sentences: Array.from(sentenceSegmenter.segment(block), ({ segment }) => ({
        text: segment.trim(),
        tokens: Array.from(wordSegmenter.segment(segment), (word): Token =>
          word.isWordLike && LETTER.test(word.segment)
            ? { kind: 'word', text: word.segment, term: normalizeTerm(word.segment, language) }
            : { kind: 'text', text: word.segment },
        ),
      })),
    }))
}

export function wordPositions(paragraphs: Paragraph[]): WordPosition[] {
  const positions: WordPosition[] = []
  paragraphs.forEach((paragraph, p) =>
    paragraph.sentences.forEach((sentence, s) =>
      sentence.tokens.forEach((token, t) => {
        if (token.kind === 'word') positions.push({ paragraph: p, sentence: s, token: t })
      }),
    ),
  )
  return positions
}

export function uniqueTerms(paragraphs: Paragraph[]): string[] {
  const terms = new Set<string>()
  for (const paragraph of paragraphs)
    for (const sentence of paragraph.sentences)
      for (const token of sentence.tokens) if (token.kind === 'word') terms.add(token.term)
  return [...terms]
}

function wordsIn(sentences: Sentence[]): number {
  let count = 0
  for (const sentence of sentences) for (const token of sentence.tokens) if (token.kind === 'word') count++
  return count
}

/**
 * Groups paragraphs into pages of roughly `wordsPerPage` words without splitting
 * paragraphs, except very long ones, which are split between sentences.
 */
export function paginate(paragraphs: Paragraph[], wordsPerPage = 350): Paragraph[][] {
  const pieces: Paragraph[] = []
  for (const paragraph of paragraphs) {
    if (wordsIn(paragraph.sentences) <= wordsPerPage * 1.5) {
      pieces.push(paragraph)
      continue
    }
    let chunk: Sentence[] = []
    for (const sentence of paragraph.sentences) {
      if (chunk.length && wordsIn([...chunk, sentence]) > wordsPerPage) {
        pieces.push({ sentences: chunk })
        chunk = []
      }
      chunk.push(sentence)
    }
    if (chunk.length) pieces.push({ sentences: chunk })
  }

  const pages: Paragraph[][] = []
  let page: Paragraph[] = []
  let count = 0
  for (const piece of pieces) {
    const words = wordsIn(piece.sentences)
    // Start a new page once this one is reasonably full, so pages don't end up very short.
    if (page.length && count >= wordsPerPage * 0.6 && count + words > wordsPerPage) {
      pages.push(page)
      page = []
      count = 0
    }
    page.push(piece)
    count += words
  }
  if (page.length) pages.push(page)
  return pages
}

/**
 * The word token at a character position of a sentence's (trimmed) text, as reported by
 * speech synthesis while it reads. Falls back to the next word after that position.
 */
export function wordTokenAt(sentence: Sentence, charIndex: number): number | undefined {
  const full = sentence.tokens.map((token) => token.text).join('')
  let position = -(full.length - full.trimStart().length)
  let next: number | undefined
  for (let k = 0; k < sentence.tokens.length; k++) {
    const token = sentence.tokens[k]
    const end = position + token.text.length
    if (token.kind === 'word') {
      if (charIndex >= position && charIndex < end) return k
      if (next === undefined && position >= charIndex) next = k
    }
    position = end
  }
  return next
}

export function countWords(content: string, language: string): number {
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' })
  let count = 0
  for (const word of segmenter.segment(content)) if (word.isWordLike && LETTER.test(word.segment)) count++
  return count
}
