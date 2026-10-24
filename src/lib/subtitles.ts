import { normalizeTerm } from './tokenize'

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024
const MAX_CUES = 5_000

export class SubtitleError extends Error {
  code: 'size' | 'format' | 'empty'
  constructor(code: 'size' | 'format' | 'empty') {
    super(code)
    this.name = 'SubtitleError'
    this.code = code
  }
}

function timestamp(value: string, vtt: boolean): number {
  const pattern = vtt ? /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/ : /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/
  const match = pattern.exec(value)
  if (!match) throw new SubtitleError('format')
  const [, hours = '0', minutes, seconds, millis] = match
  if (+hours > 99 || +minutes > 59 || +seconds > 59) throw new SubtitleError('format')
  return +hours * 3600 + +minutes * 60 + +seconds + +millis / 1000
}

function plainCue(text: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' }
  return text.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (original, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity] ?? original
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : +entity.slice(1)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
  // Remove embedded control characters from untrusted files while retaining tabs and line breaks.
  // eslint-disable-next-line no-control-regex
  }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
}

/** Parses complete SRT/WebVTT files, rejecting partial/broken imports instead of losing cues silently. */
export function parseSubtitles(source: string): SubtitleCue[] {
  if (new TextEncoder().encode(source).length > MAX_SUBTITLE_BYTES) throw new SubtitleError('size')
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) throw new SubtitleError('empty')
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)
  const blocks = normalized.split(/\n[ \t]*\n+/)
  if (vtt) blocks.shift()
  const cues: SubtitleCue[] = []
  let total = 0
  for (const block of blocks) {
    const lines = block.split('\n')
    if (vtt && /^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0])) continue
    const timeLine = lines[0].includes('-->') ? 0 : 1
    if (timeLine === 1 && (!lines[0].trim() || (!vtt && !/^\d+$/.test(lines[0].trim())))) throw new SubtitleError('format')
    const timing = /^(\S+)\s+-->\s+(\S+)(?:[ \t]+(.*))?$/.exec(lines[timeLine]?.trim() ?? '')
    if (!timing || (!vtt && timing[3])) throw new SubtitleError('format')
    const start = timestamp(timing[1], vtt)
    const end = timestamp(timing[2], vtt)
    if (end <= start || (cues.length && start < cues[cues.length - 1].start)) throw new SubtitleError('format')
    const body = lines.slice(timeLine + 1).join('\n')
    if (body.includes('-->')) throw new SubtitleError('format')
    const text = plainCue(body)
    if (!text) throw new SubtitleError('format')
    total += text.length
    if (text.length > 4_000 || total > 500_000 || cues.length >= MAX_CUES) throw new SubtitleError('size')
    cues.push({ start, end, text })
  }
  if (!cues.length) throw new SubtitleError('empty')
  return cues
}

/** Last active cue wins for overlapping captions; gaps and exclusive ends have no active cue. */
export function activeCueAt(cues: readonly SubtitleCue[], time: number): number {
  if (!Number.isFinite(time) || time < 0) return -1
  for (let i = cues.length - 1; i >= 0; i--) if (cues[i].start <= time && time < cues[i].end) return i
  return -1
}

export function subtitleTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(time / 3600)
  return `${hours ? `${hours}:` : ''}${String(Math.floor(time / 60) % 60).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`
}

function dictationTokens(text: string, language: string): string[] {
  return Array.from(new Intl.Segmenter(language, { granularity: 'word' }).segment(normalizeTerm(text.normalize('NFC'), language)))
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
}

/** Word edit distance penalizes omissions, insertions, and substitutions; accents remain meaningful. */
export function checkDictation(expected: string, answer: string, language: string): { correct: boolean; accuracy: number; mistakes: number } {
  const target = dictationTokens(expected, language)
  const actual = dictationTokens(answer.slice(0, 8_000), language)
  if (!target.length || !actual.length) return { correct: false, accuracy: 0, mistakes: target.length || 1 }
  let row = actual.map((_, i) => i + 1)
  row.unshift(0)
  for (let i = 1; i <= target.length; i++) {
    const next = [i]
    for (let j = 1; j <= actual.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (target[i - 1] === actual[j - 1] ? 0 : 1))
    row = next
  }
  const mistakes = row[actual.length]
  return { correct: mistakes === 0, accuracy: Math.max(0, Math.round((1 - mistakes / Math.max(target.length, actual.length)) * 100)), mistakes }
}
