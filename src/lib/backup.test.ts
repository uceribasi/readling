import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importBackup } from './backup'
import { db, type TextDoc, type WordEntry } from './db'

function backupFile(texts: Partial<TextDoc>[], words: Partial<WordEntry>[], files: object[] = []): File {
  return new File([JSON.stringify({ app: 'readling', version: 1, exportedAt: '2026-10-17T00:00:00.000Z', texts, words, files })], 'backup.json')
}

const text = (id: number, title: string, createdAt: number): TextDoc => ({
  id,
  title,
  language: 'en',
  content: title,
  kind: 'text',
  createdAt,
  updatedAt: createdAt,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(() => vi.restoreAllMocks())

describe('importBackup', () => {
  it('merges newer quiz history from old app versions without reverting word status', async () => {
    const base: WordEntry = { key: 'en:bank', language: 'en', term: 'bank', status: 'known', createdAt: 0, updatedAt: 100 }
    await db.words.put({ ...base, quiz: { correct: 1, wrong: 0, lastAt: 200 } })
    const newerQuiz = { correct: 7, wrong: 2, lastAt: 300 }
    const file = backupFile([], [{ ...base, status: 'learning', quiz: newerQuiz }])
    expect((await importBackup(file)).words).toBe(1)
    expect(await db.words.get(base.key)).toMatchObject({ status: 'known', quiz: newerQuiz })
    expect((await importBackup(file)).words).toBe(0)
    await importBackup(backupFile([], [{ ...base, status: 'ignored', updatedAt: 400, quiz: { correct: 1, wrong: 0, lastAt: 200 } }]))
    expect(await db.words.get(base.key)).toMatchObject({ status: 'ignored', quiz: newerQuiz })
  })

  it.each([
    { version: 99 },
    { texts: [text(1, 'Invalid language', 1), { ...text(2, 'Broken', 2), language: 'not-a-locale' }] },
    { words: [{ key: 'en:x', language: 'en', term: 'x', status: 'broken', createdAt: 0, updatedAt: 1 }] },
    { words: [{ key: 'fr:x', language: 'en', term: 'x', status: 'known', createdAt: 0, updatedAt: 1 }] },
    { words: [{ key: 'en:x', language: 'en', term: 'x', status: 'known', createdAt: 0, updatedAt: 1, card: { due: 'invalid' } }] },
    { activity: [{ date: '2026-02-30', wordsRead: 1, reviews: 0, quiz: 0 }] },
    { activity: [{ date: '2026-10-17', wordsRead: -1, reviews: 0, quiz: 0 }] },
    { files: [{ id: 'x', name: 'x.pdf', type: 'application/pdf', createdAt: 0, data: 'https://example.invalid/tracker' }] },
    { files: [{ id: 'x', name: 'x.pdf', type: 'application/pdf', createdAt: 0, data: 'data:application/pdf;base64,!!!' }] },
    { texts: [{ ...text(1, 'Missing PDF', 0), kind: 'pdf', fileId: 'missing' }] },
  ])('rejects malformed backups atomically: %j', async (change) => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const raw = { app: 'readling', version: 1, exportedAt: '2026-10-17T00:00:00.000Z', texts: [text(1, 'Valid', 1)], words: [], ...change }
    await expect(importBackup(new File([JSON.stringify(raw)], 'bad.json'))).rejects.toThrow('not-a-backup')
    expect(await db.texts.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('adds texts from another device under new ids instead of overwriting', async () => {
    await db.texts.add(text(1, 'Local text', 10))
    const result = await importBackup(backupFile([text(1, 'Other device', 20)], []))
    expect(result.texts).toBe(1)
    const titles = (await db.texts.toArray()).map((doc) => `${doc.id}:${doc.title}`)
    expect(titles).toEqual(['1:Local text', '2:Other device'])
  })

  it('skips texts that are already here', async () => {
    await db.texts.add(text(1, 'Same text', 10))
    expect((await importBackup(backupFile([text(1, 'Same text', 10)], []))).texts).toBe(0)
    expect(await db.texts.count()).toBe(1)
  })

  it('keeps the most recently updated copy of each word', async () => {
    await db.words.bulkPut([
      { key: 'en:fog', language: 'en', term: 'fog', status: 'known', createdAt: 0, updatedAt: 500 },
      { key: 'en:cat', language: 'en', term: 'cat', status: 'learning', createdAt: 0, updatedAt: 100 },
    ])
    const result = await importBackup(
      backupFile(
        [],
        [
          { key: 'en:fog', language: 'en', term: 'fog', status: 'learning', createdAt: 0, updatedAt: 100 },
          { key: 'en:cat', language: 'en', term: 'cat', status: 'known', createdAt: 0, updatedAt: 900 },
          { key: 'en:new', language: 'en', term: 'new', status: 'known', createdAt: 0, updatedAt: 1 },
        ],
      ),
    )
    expect(result.words).toBe(2)
    expect((await db.words.get('en:fog'))?.status).toBe('known')
    expect((await db.words.get('en:cat'))?.status).toBe('known')
    expect(await db.words.get('en:new')).toBeDefined()
  })

  it('turns card dates back into Date objects and restores PDF files', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const due = '2026-01-02T00:00:00.000Z'
    const card = { due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 }
    const pdf = { id: 'file-1', name: 'a.pdf', type: 'application/pdf', createdAt: 0, data: 'data:application/pdf;base64,JVBERi0=' }
    await importBackup(
      backupFile([], [{ key: 'en:x', language: 'en', term: 'x', status: 'learning', card: card as never, createdAt: 0, updatedAt: 1 }], [pdf]),
    )
    expect((await db.words.get('en:x'))?.card?.due).toEqual(new Date(due))
    expect((await db.files.get('file-1'))?.blob.size).toBe(5)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects files that are not readling backups', async () => {
    await expect(importBackup(new File(['{"hello": 1}'], 'x.json'))).rejects.toThrow('not-a-backup')
  })

  it('merges daily activity without counting a day twice', async () => {
    await db.activity.put({ date: '2026-10-16', wordsRead: 300, wordsAdded: 5, reviews: 2, quiz: 0 })
    const file = new File(
      [
        JSON.stringify({
          app: 'readling',
          version: 1,
          exportedAt: '2026-10-17T00:00:00.000Z',
          texts: [],
          words: [],
          activity: [
            { date: '2026-10-16', wordsRead: 100, wordsAdded: 9, reviews: 2, quiz: 4 },
            { date: '2026-10-15', wordsRead: 50, reviews: 0, quiz: 0 },
          ],
        }),
      ],
      'backup.json',
    )
    await importBackup(file)
    expect(await db.activity.get('2026-10-16')).toEqual({ date: '2026-10-16', wordsRead: 300, wordsAdded: 9, reviews: 2, quiz: 4 })
    expect(await db.activity.get('2026-10-15')).toMatchObject({ wordsRead: 50, wordsAdded: 0 })
  })
})
