import { describe, expect, it } from 'vitest'
import { estimateLevel, lastDays, streakOf } from './stats'

describe('streakOf', () => {
  const days = new Set(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15', '2026-10-16'])

  it('counts consecutive days up to today', () => {
    expect(streakOf(days, '2026-10-16')).toEqual({ current: 3, best: 3, activeToday: true })
  })

  it('keeps yesterday’s streak alive until today is over', () => {
    expect(streakOf(days, '2026-10-17')).toEqual({ current: 3, best: 3, activeToday: false })
  })

  it('breaks after a missed day', () => {
    expect(streakOf(days, '2026-10-18').current).toBe(0)
  })

  it('crosses month boundaries', () => {
    const run = new Set(['2026-09-29', '2026-09-30', '2026-10-01'])
    expect(streakOf(run, '2026-10-01')).toEqual({ current: 3, best: 3, activeToday: true })
  })
})

describe('lastDays', () => {
  it('lists days oldest first, ending today', () => {
    expect(lastDays(3, new Date(2026, 2, 1))).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })
})

describe('estimateLevel', () => {
  it('maps known words to a rough CEFR level', () => {
    expect(estimateLevel(0, 'en')).toMatchObject({ level: 'A1', next: 'A2', nextAt: 1000, progress: 0 })
    expect(estimateLevel(3_000, 'en')).toMatchObject({ level: 'B1', next: 'B2' })
    expect(estimateLevel(20_000, 'en')).toEqual({ level: 'C2', progress: 1 })
  })

  it('asks for more word forms in highly inflected languages', () => {
    expect(estimateLevel(3_000, 'ru').level).toBe('A2')
  })
})
