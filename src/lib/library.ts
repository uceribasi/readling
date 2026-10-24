import type { TextDoc } from './db'
import type { Paragraph } from './tokenize'

export type ReadingStatus = 'unread' | 'reading' | 'finished'
export interface LibraryFilters { query: string; language: string; status: string; collection: string }

export function readingStatus(text: TextDoc): ReadingStatus {
  return text.readingStatus ?? (text.lastOpenedAt || (text.readingPage ?? 0) > 0 ? 'reading' : 'unread')
}

/** Empty filters preserve the library's existing ordering. */
export function filterLibrary<T extends TextDoc>(texts: readonly T[], filters: LibraryFilters): T[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return texts.filter((text) =>
    (!filters.language || text.language === filters.language) &&
    (!filters.status || readingStatus(text) === filters.status) &&
    (!filters.collection || (filters.collection === '__none__' ? !text.collection : text.collection === filters.collection)) &&
    (!query || `${text.title}\n${text.collection ?? ''}\n${text.content}`.toLocaleLowerCase().includes(query)),
  )
}

export function clampReadingPage(page: number | undefined, total: number): number {
  return Math.min(Math.max(Number.isFinite(page) ? Math.floor(page!) : 0, 0), Math.max(total - 1, 0))
}

export interface ReaderLocation { page: number; sentence: number; start: number; end: number }

/** Reconciles tokenizer whitespace normalization with offsets in the saved original text. */
export function readerLocations(content: string, pages: readonly Paragraph[][]): ReaderLocation[] {
  const offsets: number[] = []
  let normalized = ''
  let whitespace = false
  for (let i = 0; i < content.length; i++) {
    if (/\s/u.test(content[i])) {
      if (!whitespace) { normalized += ' '; offsets.push(i) }
      whitespace = true
    } else {
      normalized += content[i]
      offsets.push(i)
      whitespace = false
    }
  }
  const locations: ReaderLocation[] = []
  let cursor = 0
  pages.forEach((paragraphs, page) => {
    let ordinal = 0
    for (const paragraph of paragraphs) for (const sentence of paragraph.sentences) {
      const needle = sentence.text.replace(/\s+/gu, ' ').trim()
      const found = normalized.indexOf(needle, cursor)
      if (found >= 0 && needle) {
        const end = found + needle.length
        locations.push({ page, sentence: ordinal, start: offsets[found], end: offsets[end - 1] + 1 })
        cursor = end
      }
      ordinal++
    }
  })
  return locations
}

export function locationAt(locations: readonly ReaderLocation[], offset: number): ReaderLocation | undefined {
  // A chapter starts at its first character; whitespace belongs to the following sentence.
  return locations.find((location) => offset < location.end) ?? locations.at(-1)
}

export interface TextSearchMatch { start: number; end: number; excerpt: string; page: number; sentence?: number }

export function searchReaderText(content: string, query: string, locations: readonly ReaderLocation[], limit = 100): TextSearchMatch[] {
  const trimmed = query.trim()
  if (!trimmed || limit <= 0) return []
  const pattern = trimmed.split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const regex = new RegExp(pattern, 'giu')
  const matches: TextSearchMatch[] = []
  for (const match of content.matchAll(regex)) {
    const start = match.index
    const end = start + match[0].length
    const location = locationAt(locations, start)
    matches.push({
      start, end, page: location?.page ?? 0, sentence: location?.sentence,
      excerpt: `${start > 45 ? '…' : ''}${content.slice(Math.max(0, start - 45), Math.min(content.length, end + 65)).replace(/\s+/gu, ' ')}${end + 65 < content.length ? '…' : ''}`,
    })
    if (matches.length >= limit) break
  }
  return matches
}
