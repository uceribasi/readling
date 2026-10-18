import type { Card } from 'ts-fsrs'
import type { Explanation } from './ai/types'
import type { DayActivity, StoredFile, TextDoc, WordEntry } from './db'
import { LANGUAGES } from './languages'

export interface BackupFile extends Omit<StoredFile, 'blob'> {
  data: string
}

export interface Backup {
  app: 'readling'
  version: 1
  exportedAt: string
  texts: TextDoc[]
  words: WordEntry[]
  /** Missing in backups made before PDFs and activity were supported. */
  files?: BackupFile[]
  activity?: DayActivity[]
}

function invalid(): never {
  throw new Error('not-a-backup')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function string(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) return invalid()
  return value
}

function number(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) return invalid()
  return value
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value)
}

function count(value: unknown): number {
  return number(value, true)
}

function timestamp(value: unknown): number {
  const time = count(value)
  if (!Number.isFinite(new Date(time).getTime())) return invalid()
  return time
}

function date(value: unknown): Date {
  const text = string(value)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return invalid()
  const result = new Date(text)
  if (!Number.isFinite(result.getTime()) || result.toISOString() !== text) return invalid()
  return result
}

function language(value: unknown): string {
  const code = string(value)
  if (!(LANGUAGES as readonly string[]).includes(code)) return invalid()
  return code
}

function array<T>(value: unknown, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid()
  return value.map(parse)
}

function unique<T>(items: T[], key: (item: T) => string | number): T[] {
  if (new Set(items.map(key)).size !== items.length) return invalid()
  return items
}

function explanation(value: unknown): Explanation {
  const item = record(value)
  return {
    lemma: string(item.lemma, true),
    partOfSpeech: string(item.partOfSpeech, true),
    translation: string(item.translation, true),
    meaning: string(item.meaning, true),
    grammar: string(item.grammar, true),
    example: string(item.example, true),
    exampleTranslation: string(item.exampleTranslation, true),
  }
}

function card(value: unknown): Card {
  const item = record(value)
  const state = count(item.state)
  const difficulty = number(item.difficulty)
  if (state > 3 || difficulty > 10) return invalid()
  return {
    due: date(item.due),
    last_review: optional(item.last_review, date),
    stability: number(item.stability),
    difficulty,
    elapsed_days: count(item.elapsed_days),
    scheduled_days: count(item.scheduled_days),
    learning_steps: item.learning_steps === undefined ? 0 : count(item.learning_steps),
    reps: count(item.reps),
    lapses: count(item.lapses),
    state,
  }
}

function word(value: unknown): WordEntry {
  const item = record(value)
  const lang = language(item.language)
  const term = string(item.term)
  const key = string(item.key)
  if (key !== lang + ':' + term || !['learning', 'known', 'ignored'].includes(string(item.status))) return invalid()
  return {
    key,
    language: lang,
    term,
    status: item.status as WordEntry['status'],
    context: optional(item.context, (value) => string(value, true)),
    translation: optional(item.translation, (value) => string(value, true)),
    explanation: optional(item.explanation, explanation),
    card: optional(item.card, card),
    quiz: optional(item.quiz, (value) => {
      const stats = record(value)
      return { correct: count(stats.correct), wrong: count(stats.wrong), lastAt: timestamp(stats.lastAt) }
    }),
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
  }
}

function text(value: unknown): TextDoc {
  const item = record(value)
  const id = count(item.id)
  const kind = optional(item.kind, string)
  if (id < 1 || (kind !== undefined && kind !== 'text' && kind !== 'pdf')) return invalid()
  const fileId = optional(item.fileId, string)
  if (kind === 'pdf' && !fileId) return invalid()
  const sourceUrl = optional(item.sourceUrl, string)
  if (sourceUrl) {
    let url: URL
    try { url = new URL(sourceUrl) } catch { return invalid() }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return invalid()
  }
  return {
    id,
    kind: kind as TextDoc['kind'],
    title: string(item.title),
    language: language(item.language),
    content: string(item.content, true),
    fileId,
    sourceUrl,
    pageCount: optional(item.pageCount, count),
    wordCount: optional(item.wordCount, count),
    readingPage: optional(item.readingPage, count),
    progress: optional(item.progress, (value) => {
      const progress = record(value)
      const known = count(progress.known)
      const learning = count(progress.learning)
      const total = count(progress.total)
      if (known + learning > total) return invalid()
      return { known, learning, total }
    }),
    createdAt: timestamp(item.createdAt),
    updatedAt: timestamp(item.updatedAt),
    lastOpenedAt: optional(item.lastOpenedAt, timestamp),
  }
}

const PDF_DATA = /^data:(application\/pdf|application\/octet-stream)?;base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/

function file(value: unknown): BackupFile {
  const item = record(value)
  const data = string(item.data)
  const type = string(item.type, true)
  if (!['', 'application/pdf', 'application/octet-stream'].includes(type) || !PDF_DATA.test(data)) return invalid()
  return { id: string(item.id), name: string(item.name), type, data, createdAt: timestamp(item.createdAt) }
}

function activity(value: unknown): DayActivity {
  const item = record(value)
  const day = string(item.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return invalid()
  const parsed = new Date(day + 'T00:00:00.000Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return invalid()
  return {
    date: day,
    wordsRead: count(item.wordsRead),
    wordsAdded: item.wordsAdded === undefined ? 0 : count(item.wordsAdded),
    reviews: count(item.reviews),
    quiz: count(item.quiz),
  }
}

/** Validate the entire backup before any network request or database write. */
export function parseBackup(value: unknown): Backup {
  const item = record(value)
  if (item.app !== 'readling' || item.version !== 1) return invalid()
  date(item.exportedAt)
  const files = unique(array(item.files === undefined ? [] : item.files, file), (file) => file.id)
  const texts = unique(array(item.texts, text), (text) => text.id)
  const fileIds = new Set(files.map((file) => file.id))
  if (texts.some((text) => text.kind === 'pdf' && !fileIds.has(text.fileId!))) return invalid()
  return {
    app: 'readling',
    version: 1,
    exportedAt: string(item.exportedAt),
    texts,
    words: unique(array(item.words, word), (word) => word.key),
    files,
    activity: unique(array(item.activity === undefined ? [] : item.activity, activity), (day) => day.date),
  }
}

/** Decode embedded bytes locally; backup data can never initiate an HTTP request. */
export function restoreFile({ data, ...file }: BackupFile): StoredFile {
  if (!PDF_DATA.test(data)) return invalid()
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (char) => char.charCodeAt(0))
  return { ...file, blob: new Blob([bytes], { type: file.type || 'application/pdf' }) }
}
