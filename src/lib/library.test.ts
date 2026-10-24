import { describe, expect, it } from 'vitest'
import type { TextDoc } from './db'
import { clampReadingPage, filterLibrary, locationAt, readerLocations, readingStatus, searchReaderText } from './library'
import { paginate, tokenize } from './tokenize'

const doc = (id: number, extra: Partial<TextDoc> = {}): TextDoc => ({ id, title: 'A story', content: 'The lighthouse by the sea.', language: 'en', createdAt: 1, updatedAt: 1, ...extra })
const emptyFilters = { query: '', language: '', status: '', collection: '' }

describe('library filters', () => {
  it('combines filters without changing recency order', () => {
    const texts = [doc(3, { collection: 'Stories', readingStatus: 'reading' }), doc(1, { collection: 'Stories', readingStatus: 'finished' }), doc(2, { language: 'es', collection: 'Stories' })]
    expect(filterLibrary(texts, { query: ' LIGHTHOUSE ', language: 'en', collection: 'Stories', status: 'reading' }).map((text) => text.id)).toEqual([3])
    expect(filterLibrary(texts, emptyFilters).map((text) => text.id)).toEqual([3, 1, 2])
  })
  it('searches titles and collection names and distinguishes uncollected texts', () => {
    const texts = [doc(1, { title: 'El faro' }), doc(2, { collection: 'FARO' })]
    expect(filterLibrary(texts, { ...emptyFilters, query: 'faro' })).toHaveLength(2)
    expect(filterLibrary(texts, { ...emptyFilters, collection: '__none__' }).map((text) => text.id)).toEqual([1])
  })
  it('derives legacy status without overriding explicit user choice', () => {
    expect(readingStatus(doc(1))).toBe('unread')
    expect(readingStatus(doc(1, { lastOpenedAt: 20 }))).toBe('reading')
    expect(readingStatus(doc(1, { readingPage: 2 }))).toBe('reading')
    expect(readingStatus(doc(1, { lastOpenedAt: 20, readingStatus: 'unread' }))).toBe('unread')
  })
})

describe('reader source locations', () => {
  it('maps repeated sentences and normalized line breaks back to their original pages', () => {
    const content = '  Hello\n world.  Hello world.\n\nLast\tline.'
    const pages = paginate(tokenize(content, 'en'), 2)
    const locations = readerLocations(content, pages)
    expect(locations.map(({ start, end }) => content.slice(start, end))).toEqual(['Hello\n world.', 'Hello world.', 'Last\tline.'])
    expect(locations.map(({ page }) => page)).toEqual([0, 1, 2])
    expect(locationAt(locations, content.indexOf('Last'))?.page).toBe(2)
    expect(locationAt(locations, content.indexOf('\n\n'))?.page).toBe(2)
  })
  it('finds literal phrases across whitespace with the matching page and sentence', () => {
    const content = 'First page.\n\nHello\nworld. Price: $2.00 (USD).'
    const locations = readerLocations(content, paginate(tokenize(content, 'en'), 2))
    const matches = searchReaderText(content, 'HELLO world', locations)
    expect(matches).toHaveLength(1)
    expect(content.slice(matches[0].start, matches[0].end)).toBe('Hello\nworld')
    expect(matches[0].page).toBe(1)
    expect(searchReaderText(content, '$2.00 (USD)', locations)).toHaveLength(1)
    expect(searchReaderText(content, '   ', locations)).toEqual([])
    expect(searchReaderText('x '.repeat(500), 'x', [], 100)).toHaveLength(100)
  })
  it('clamps stale or invalid reading positions, including empty documents', () => {
    expect(clampReadingPage(8, 3)).toBe(2)
    expect(clampReadingPage(-1, 3)).toBe(0)
    expect(clampReadingPage(NaN, 3)).toBe(0)
    expect(clampReadingPage(Infinity, 3)).toBe(0)
    expect(clampReadingPage(2.8, 4)).toBe(2)
    expect(clampReadingPage(2, 0)).toBe(0)
  })
})
