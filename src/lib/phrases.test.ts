import { describe, expect, it } from 'vitest'
import { buildPhraseIndex, displayTerm, findPhrases, isPhrase, phraseTerm } from './phrases'

describe('phrases', () => {
  const index = buildPhraseIndex(['a pesar de', 'a pesar', 'de la', 'faro', 'dar la vuelta'])

  it('builds terms from words and tells phrases from words', () => {
    expect(phraseTerm(['give', 'up'])).toBe('give up')
    expect(isPhrase('give up')).toBe(true)
    expect(isPhrase('faro')).toBe(false)
  })

  it('finds the longest saved phrase first, without overlaps', () => {
    const words = ['a', 'pesar', 'de', 'la', 'lluvia', 'vamos', 'a', 'dar', 'la', 'vuelta']
    expect(findPhrases(words, index)).toEqual([
      { start: 0, end: 2, term: 'a pesar de' },
      { start: 7, end: 9, term: 'dar la vuelta' },
    ])
  })

  it('ignores partial matches at the end of a sentence', () => {
    expect(findPhrases(['dar', 'la'], index)).toEqual([])
  })

  it('shows phrases in languages without spaces without separators', () => {
    expect(displayTerm('食べ て いる', 'ja')).toBe('食べている')
    expect(displayTerm('give up', 'en')).toBe('give up')
  })
})
