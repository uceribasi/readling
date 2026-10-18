import { db, type DayActivity, type TextDoc, type WordEntry } from './db'
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

export async function exportBackup(): Promise<void> {
  const files = await db.files.toArray()
  const backup: Backup = {
    app: 'readling',
    version: 1,
    exportedAt: new Date().toISOString(),
    texts: await db.texts.toArray(),
    words: await db.words.toArray(),
    files: await Promise.all(files.map(async ({ blob, ...file }) => ({ ...file, data: await toDataUrl(blob) }))),
    activity: await db.activity.toArray(),
  }
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
  const words = parsed.words
  const files = (parsed.files ?? []).map(restoreFile)
  const texts = parsed.texts
  const activity = Array.isArray(parsed.activity) ? parsed.activity : []

  return db.transaction('rw', [db.texts, db.words, db.files, db.activity], async () => {
    // Text ids are per-browser counters, so a backup's ids can clash with local texts.
    // Import each text under a new id unless the very same text is already here.
    const local = await db.texts.toArray()
    const sameText = (a: TextDoc, b: TextDoc) => a.createdAt === b.createdAt && a.title === b.title && a.kind === b.kind
    const newTexts = texts.filter((text) => !local.some((existing) => sameText(existing, text)))
    await db.texts.bulkAdd(newTexts.map(({ id: _id, ...text }) => text) as TextDoc[])

    // Quiz history has its own clock: older app versions didn't advance updatedAt after tests.
    const existingWords = await db.words.bulkGet(words.map((word) => word.key))
    const newerWords: WordEntry[] = []
    words.forEach((word, index) => {
      const existing = existingWords[index]
      if (!existing) {
        newerWords.push(word)
        return
      }
      const base = word.updatedAt > existing.updatedAt ? word : existing
      const quiz = (word.quiz?.lastAt ?? -1) > (existing.quiz?.lastAt ?? -1) ? word.quiz : existing.quiz
      if (base !== existing || quiz !== existing.quiz) newerWords.push({ ...base, quiz })
    })
    await db.words.bulkPut(newerWords)

    // File ids are random UUIDs, so they never clash.
    await db.files.bulkPut(files)

    // The same day may be in both; keep the larger count of each kind so nothing is counted twice.
    const localDays = await db.activity.bulkGet(activity.map((day) => day.date))
    await db.activity.bulkPut(
      activity.map((day, index) => {
        const local = localDays[index]
        const most = (field: keyof Omit<DayActivity, 'date'>) => Math.max(day[field] ?? 0, local?.[field] ?? 0)
        return { date: day.date, wordsRead: most('wordsRead'), wordsAdded: most('wordsAdded'), reviews: most('reviews'), quiz: most('quiz') }
      }),
    )
    return { texts: newTexts.length, words: newerWords.length }
  })
}
