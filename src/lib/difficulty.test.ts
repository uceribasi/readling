import { describe, expect, it } from 'vitest'
import { difficultyOf, measureText } from './difficulty'

describe('difficulty', () => {
  it('counts unique words by status, with ignored words as known', () => {
    const words = new Map([
      ['the', { status: 'known' as const }],
      ['lighthouse', { status: 'learning' as const }],
      ['marlo', { status: 'ignored' as const }],
    ])
    expect(measureText('The lighthouse. Marlo saw the lighthouse at night.', 'en', words)).toEqual({
      known: 2,
      learning: 1,
      total: 6,
    })
  })

  it('labels texts by the share of words not known yet', () => {
    expect(difficultyOf({ known: 95, learning: 3, total: 100 })).toBe('easy')
    expect(difficultyOf({ known: 80, learning: 10, total: 100 })).toBe('good')
    expect(difficultyOf({ known: 65, learning: 0, total: 100 })).toBe('challenging')
    expect(difficultyOf({ known: 10, learning: 0, total: 100 })).toBe('hard')
  })
})
