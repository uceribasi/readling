import { describe, expect, it } from 'vitest'
import { countWords, normalizeTerm, paginate, tokenize, uniqueTerms, wordPositions, wordTokenAt } from './tokenize'

describe('tokenize', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    const paragraphs = tokenize('First line\ncontinues here.\n\nSecond paragraph.', 'en')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].sentences[0].text).toBe('First line continues here.')
  })

  it('splits sentences and marks words versus punctuation', () => {
    const [paragraph] = tokenize('Hello, world! How are you?', 'en')
    expect(paragraph.sentences.map((sentence) => sentence.text)).toEqual(['Hello, world!', 'How are you?'])
    const words = paragraph.sentences[0].tokens.filter((token) => token.kind === 'word').map((token) => token.text)
    expect(words).toEqual(['Hello', 'world'])
  })

  it('does not treat numbers as words to learn', () => {
    expect(uniqueTerms(tokenize('In 1999 we had 3 cats.', 'en'))).toEqual(['in', 'we', 'had', 'cats'])
  })

  it('segments languages without spaces', () => {
    const terms = uniqueTerms(tokenize('私は学生です。', 'ja'))
    expect(terms.length).toBeGreaterThan(1)
    expect(terms.join('')).toBe('私は学生です')
  })

  it('lists every word position in reading order', () => {
    const paragraphs = tokenize('One two.\n\nThree.', 'en')
    expect(wordPositions(paragraphs)).toHaveLength(3)
  })
})

describe('paginate', () => {
  // Sentences start with a capital letter, otherwise ICU doesn't break after the period.
  const sentence = (n: number) => 'Start ' + Array.from({ length: n - 1 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ') + '.'

  it('keeps short texts on one page', () => {
    expect(paginate(tokenize('A short text.\n\nAnother paragraph.', 'en'), 100)).toHaveLength(1)
  })

  it('fills pages paragraph by paragraph without splitting them', () => {
    const text = Array.from({ length: 6 }, () => sentence(40)).join('\n\n')
    const pages = paginate(tokenize(text, 'en'), 100)
    expect(pages.map((page) => page.length)).toEqual([2, 2, 2])
  })

  it('splits a very long paragraph between sentences', () => {
    const text = Array.from({ length: 10 }, () => sentence(30)).join(' ')
    const pages = paginate(tokenize(text, 'en'), 100)
    expect(pages.length).toBeGreaterThan(2)
    expect(pages.flat().flatMap((paragraph) => paragraph.sentences)).toHaveLength(10)
  })
})

describe('normalizeTerm', () => {
  it('lowercases per language and unifies apostrophes', () => {
    expect(normalizeTerm('İstanbul', 'tr')).toBe('istanbul')
    expect(normalizeTerm('Don’t', 'en')).toBe("don't")
  })
})

describe('countWords', () => {
  it('counts only words with letters', () => {
    expect(countWords('It costs 5 euros, right?', 'en')).toBe(4)
  })
})

describe('wordTokenAt', () => {
  const [sentence] = tokenize('  Marlo subía la escalera.', 'es')[0].sentences

  it('finds the word being read from a character position', () => {
    const at = (charIndex: number) => sentence.tokens[wordTokenAt(sentence, charIndex)!]?.text
    expect(sentence.text.slice(0, 5)).toBe('Marlo')
    expect(at(0)).toBe('Marlo')
    expect(at(8)).toBe('subía')
    expect(at(16)).toBe('escalera')
  })

  it('falls back to the next word', () => {
    expect(sentence.tokens[wordTokenAt(sentence, 5)!].text).toBe('subía')
  })
})

describe('right-to-left languages', () => {
  it('treats vowelled and unvowelled spellings as the same word', () => {
    expect(normalizeTerm('كَتَبَ', 'ar')).toBe('كتب')
    expect(normalizeTerm('שָׁלוֹם', 'he')).toBe('שלום')
  })

  it('splits Arabic and Persian text into words', () => {
    const words = (text: string, language: string) =>
      tokenize(text, language)[0].sentences.flatMap((sentence) => sentence.tokens.filter((token) => token.kind === 'word').map((token) => token.term))
    expect(words('ذهب الولد إلى المدرسة.', 'ar')).toEqual(['ذهب', 'الولد', 'إلى', 'المدرسة'])
    expect(words('من به مدرسه می‌روم.', 'fa')).toEqual(['من', 'به', 'مدرسه', 'می‌روم'])
  })
})
