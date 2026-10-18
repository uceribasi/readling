import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { csvCell, relativeTime } from './format'
import { formatInterval, newCard, previewDue, reviewCard } from './srs'

describe('srs', () => {
  it('schedules a good answer later than an "again"', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const card = newCard(now)
    const again = reviewCard(card, Rating.Again, now)
    const good = reviewCard(card, Rating.Good, now)
    expect(good.due.getTime()).toBeGreaterThan(again.due.getTime())
    const preview = previewDue(card, now)
    expect(preview[Rating.Easy].getTime()).toBeGreaterThanOrEqual(preview[Rating.Good].getTime())
  })

  it('formats intervals compactly', () => {
    const from = new Date(0)
    expect(formatInterval(from, new Date(30_000))).toBe('1m')
    expect(formatInterval(from, new Date(10 * 60_000))).toBe('10m')
    expect(formatInterval(from, new Date(3 * 3_600_000))).toBe('3h')
    expect(formatInterval(from, new Date(4 * 86_400_000))).toBe('4d')
  })
})

describe('format', () => {
  it('escapes CSV cells', () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"')
    expect(csvCell(undefined)).toBe('""')
  })

  it('writes relative times in the interface language', () => {
    expect(relativeTime(new Date(3 * 86_400_000), 0, 'en')).toBe('in 3 days')
    expect(relativeTime(new Date(3 * 86_400_000), 0, 'tr')).toBe('3 gün sonra')
  })
})
