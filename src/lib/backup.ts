import { db, legacyTextId, type DayActivity, type TextDoc, type WordEntry } from './db'
import { mergeContexts } from './vocabulary'
import { parseBackup, restoreFile, type Backup } from './backupValidation'
import { downloadFile } from './format'

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const LAST_BACKUP_KEY = 'readling.lastBackup'

/** When the last backup was downloaded in this browser, if ever. */
export function lastBackupAt(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_BACKUP_KEY))
    return value > 0 ? value : null
  } catch {
    return null
  }
}

/** Deletes every text, PDF, word and setting stored by readling in this browser. */
export async function deleteAllData(): Promise<void> {
  await db.delete()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('readling.')) localStorage.removeItem(key)
  } catch {
    // Nothing else to clear.
  }
}

/** Consistent local snapshot, reusable by download and encrypted sync. */
export async function createBackup(): Promise<Backup> {
  const [texts, words, files, activity, tombstones] = await db.transaction('r', [db.texts, db.words, db.files, db.activity, db.tombstones], () =>
    Promise.all([db.texts.toArray(), db.words.toArray(), db.files.toArray(), db.activity.toArray(), db.tombstones.toArray()]))
  return {
    app: 'readling', version: 1, exportedAt: new Date().toISOString(),
    texts: texts.map((text) => ({ ...text, syncId: text.syncId ?? legacyTextId(text) })), words,
    files: await Promise.all(files.map(async ({ blob, ...file }) => ({ ...file, data: await toDataUrl(blob) }))),
    activity, tombstones,
  }
}

export async function exportBackup(): Promise<void> {
  const backup = await createBackup()
  downloadFile(`readling-backup-${backup.exportedAt.slice(0, 10)}.json`, JSON.stringify(backup), 'application/json')
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
  } catch {
    // The reminder will simply show again.
  }
  window.dispatchEvent(new Event('readling:backup'))
}

/** Restores a backup, merging into existing data. Returns how many records were imported. */
export async function importBackup(file: File): Promise<{ texts: number; words: number }> {
  let parsed: Backup
  try {
    parsed = parseBackup(JSON.parse(await file.text()))
  } catch {
    throw new Error('not-a-backup')
  }
  return mergeBackup(parsed)
}

/** Notes merge independently from reading position, including explicit note deletions. */
export function mergeTextNotes(a: TextDoc, b: TextDoc): Pick<TextDoc, 'bookmarks' | 'bookmarkDeletions'> {
  const deletions = new Map<string, number>()
  for (const item of [...(a.bookmarkDeletions ?? []), ...(b.bookmarkDeletions ?? [])]) deletions.set(item.id, Math.max(deletions.get(item.id) ?? 0, item.deletedAt))
  const notes = new Map<string, NonNullable<TextDoc['bookmarks']>[number]>()
  for (const note of [...(a.bookmarks ?? []), ...(b.bookmarks ?? [])]) {
    if ((deletions.get(note.id) ?? -1) >= (note.updatedAt ?? note.createdAt)) continue
    const previous = notes.get(note.id)
    const delta = (note.updatedAt ?? note.createdAt) - (previous?.updatedAt ?? previous?.createdAt ?? -1)
    if (!previous || delta > 0 || (delta === 0 && JSON.stringify(note) > JSON.stringify(previous))) notes.set(note.id, note)
  }
  return {
    ...((a.bookmarks || b.bookmarks) ? { bookmarks: [...notes.values()].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id)) } : {}),
    ...((a.bookmarkDeletions || b.bookmarkDeletions) ? { bookmarkDeletions: [...deletions].sort(([a], [b]) => a.localeCompare(b)).map(([id, deletedAt]) => ({ id, deletedAt })) } : {}),
  }
}

/** Merge validated content atomically. Stable ids preserve source links across devices. */
export async function mergeBackup(parsed: Backup): Promise<{ texts: number; words: number }> {
  const words = parsed.words
  const files = (parsed.files ?? []).map(restoreFile)
  const activity = parsed.activity ?? []
  return db.transaction('rw', [db.texts, db.words, db.files, db.activity, db.tombstones], async () => {
    const oldTombstones = await db.tombstones.toArray()
    const tombstones = new Map(oldTombstones.map((entry) => [entry.key, entry.updatedAt]))
    for (const entry of parsed.tombstones ?? []) tombstones.set(entry.key, Math.max(tombstones.get(entry.key) ?? 0, entry.updatedAt))
    await db.tombstones.bulkPut([...tombstones].map(([key, updatedAt]) => ({ key, updatedAt })))
    const removed = (key: string, updatedAt: number) => (tombstones.get(key) ?? -1) >= updatedAt

    const local = await db.texts.toArray()
    const removedFileIds = new Set([...local, ...parsed.texts].filter((text) => text.fileId && removed(`text:${text.syncId ?? legacyTextId(text)}`, text.updatedAt)).map((text) => text.fileId!))
    let addedTexts = 0
    for (const incoming of parsed.texts) {
      const syncId = incoming.syncId ?? legacyTextId(incoming)
      if (removed(`text:${syncId}`, incoming.updatedAt)) continue
      const existing = local.find((text) => (text.syncId ?? legacyTextId(text)) === syncId)
      if (!existing) {
        const { id: _id, ...text } = incoming
        const id = await db.texts.add({ ...text, syncId } as TextDoc)
        local.push({ ...text, syncId, id } as TextDoc)
        addedTexts++
      } else {
        const merged = { ...(incoming.updatedAt > existing.updatedAt ? incoming : existing), ...mergeTextNotes(existing, incoming), id: existing.id, syncId }
        if (JSON.stringify(merged) !== JSON.stringify(existing)) await db.texts.put(merged)
      }
    }
    for (const text of await db.texts.toArray()) {
      if (removed(`text:${text.syncId ?? legacyTextId(text)}`, text.updatedAt)) {
        await db.texts.delete(text.id)
        if (text.fileId) await db.files.delete(text.fileId)
      }
    }

    const existingWords = await db.words.bulkGet(words.map((word) => word.key))
    const newerWords: WordEntry[] = []
    words.forEach((word, index) => {
      if (removed(`word:${word.key}`, word.updatedAt)) return
      const existing = existingWords[index]
      if (!existing) { newerWords.push({ ...word, card: word.status === 'learning' ? word.card : undefined }); return }
      const base = word.updatedAt > existing.updatedAt ? word : existing
      const statusTime = (entry: WordEntry) => entry.statusAt ?? entry.updatedAt
      const statusDifference = statusTime(word) - statusTime(existing)
      const statusTieKey = (entry: WordEntry) => JSON.stringify({ status: entry.status, card: entry.card })
      // Concurrent decisions in the same millisecond need the same winner on both devices.
      const statusSource = statusDifference > 0 || (statusDifference === 0 && statusTieKey(word) < statusTieKey(existing)) ? word : existing
      // Preserve the status clock if a newer encounter supplies the rest of the record.
      const statusAt = statusSource.statusAt ?? (base.updatedAt !== statusTime(statusSource) ? statusTime(statusSource) : undefined)
      const quiz = (word.quiz?.lastAt ?? -1) > (existing.quiz?.lastAt ?? -1) ? word.quiz : existing.quiz
      const reviewedAt = (entry: WordEntry) => entry.card?.last_review ? new Date(entry.card.last_review).getTime() : -1
      const card = statusSource.status !== 'learning' ? undefined
        : word.status === 'learning' && existing.status === 'learning' && reviewedAt(word) !== reviewedAt(existing)
          ? (reviewedAt(word) > reviewedAt(existing) ? word.card : existing.card)
          : statusTime(word) === statusTime(existing) && word.status === existing.status ? base.card : statusSource.card
      const merged = { ...base, status: statusSource.status, statusAt, quiz, card, ...((word.contexts || existing.contexts) ? { contexts: mergeContexts(existing.contexts, word.contexts) } : {}) }
      if (JSON.stringify(merged) !== JSON.stringify(existing)) newerWords.push(merged)
    })
    await db.words.bulkPut(newerWords)
    for (const word of await db.words.toArray()) if (removed(`word:${word.key}`, word.updatedAt)) await db.words.delete(word.key)

    const survivingFileIds = new Set((await db.texts.toArray()).flatMap((text) => text.fileId ? [text.fileId] : []))
    await db.files.bulkPut(files.filter((file) => !removedFileIds.has(file.id) || survivingFileIds.has(file.id)))
    const localDays = await db.activity.bulkGet(activity.map((day) => day.date))
    await db.activity.bulkPut(activity.map((day, index) => {
      const local = localDays[index]
      const most = (field: keyof Omit<DayActivity, 'date'>) => Math.max(day[field] ?? 0, local?.[field] ?? 0)
      return { date: day.date, wordsRead: most('wordsRead'), wordsAdded: most('wordsAdded'), reviews: most('reviews'), quiz: most('quiz') }
    }))
    return { texts: addedTexts, words: newerWords.length }
  })
}
