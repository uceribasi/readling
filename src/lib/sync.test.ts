import 'fake-indexeddb/auto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db, deleteText, deleteWord, rememberContext, saveExplanation, setWordStatus, type TextDoc, type WordEntry } from './db'
import { newCard } from './srs'
import { createBackup, mergeBackup } from './backup'
import { parseBackup, type Backup } from './backupValidation'
import { decryptBackup, encryptBackup, syncWithServer, validateEndpoint } from './sync'

const passphrase = 'a sufficiently long passphrase'
const base = (): Backup => ({ app: 'readling', version: 1, exportedAt: new Date().toISOString(), texts: [], words: [] })
const connection = { endpoint: 'https://cloud.example/readling.json', username: 'reader', password: 'server-secret', passphrase }
const document = (id: number, syncId: string, updatedAt = 1): TextDoc => ({ id, syncId, title: 'A book', language: 'en', content: 'A story.', kind: 'text', createdAt: 1, updatedAt })
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('encrypted sync', () => {
  it('round trips validated records with fresh random encryption and rejects a wrong password', async () => {
    const backup = { ...base(), texts: [{ ...document(1, 'stable'), bookmarks: [{ id: 'note', page: 2, label: 'Here', note: 'Private note', createdAt: 2 }] }] }
    const first = await encryptBackup(backup, passphrase)
    expect(first).not.toContain('Private note')
    expect(first).not.toEqual(await encryptBackup(backup, passphrase))
    expect((await decryptBackup(first, passphrase)).texts[0].bookmarks?.[0].note).toBe('Private note')
    await expect(decryptBackup(first, 'different-long-passphrase')).rejects.toMatchObject({ code: 'decrypt' })
  })
  it('rejects unsafe URLs and invalid envelopes', async () => {
    for (const url of ['http://remote.example/a', 'file:///tmp/a', 'https://user:password@example.com/a', 'https://example.com/a#secret']) expect(() => validateEndpoint(url)).toThrow()
    expect(validateEndpoint('http://localhost:8080/file')).toContain('localhost')
    await expect(decryptBackup('{"app":"other"}', passphrase)).rejects.toMatchObject({ code: 'format' })
    await expect(encryptBackup(base(), 'short')).rejects.toMatchObject({ code: 'passphrase' })
  })
  it('creates absent files with a precondition and never uploads plaintext', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('', { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await syncWithServer(connection)
    const request = fetch.mock.calls[1][1]
    expect(request.headers['If-None-Match']).toBe('*')
    expect(request.body).not.toContain(passphrase)
    expect(request.body).not.toContain('server-secret')
    expect(request.redirect).toBe('error')
    expect(await decryptBackup(request.body, passphrase)).toMatchObject({ app: 'readling', texts: [] })
  })
  it('refuses to overwrite a remote resource without an exposed strong ETag', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(syncWithServer(connection)).rejects.toMatchObject({ code: 'etag' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retries conflicts by fetching and merging the latest remote state', async () => {
    const first = await encryptBackup({ ...base(), texts: [document(80, 'stable')] }, passphrase)
    const second = await encryptBackup({ ...base(), texts: [{ ...document(80, 'stable', 3), readingPage: 5 }] }, passphrase)
    const fetch = vi.fn().mockResolvedValueOnce(new Response(first, { headers: { ETag: '"one"' } }))
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(new Response(second, { headers: { ETag: '"two"' } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await syncWithServer(connection)
    expect(fetch.mock.calls[1][1].headers['If-Match']).toBe('"one"')
    expect(fetch.mock.calls[3][1].headers['If-Match']).toBe('"two"')
    expect(await db.texts.count()).toBe(1)
    expect((await db.texts.toArray())[0].readingPage).toBe(5)
  })
  it('does not modify local data or upload when the decryption passphrase is wrong', async () => {
    const encrypted = await encryptBackup({ ...base(), texts: [document(1, 'remote')] }, passphrase)
    const fetch = vi.fn().mockResolvedValue(new Response(encrypted, { headers: { ETag: '"one"' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(syncWithServer({ ...connection, passphrase: 'wrong-passphrase' })).rejects.toMatchObject({ code: 'decrypt' })
    expect(await db.texts.count()).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('merge and deletion', () => {
  it('keeps local routing ids while merging remote position, notes, and encounter source links', async () => {
    await db.texts.put(document(1, 'stable'))
    await mergeBackup(parseBackup({ ...base(), texts: [{ ...document(90, 'stable', 10), readingPage: 4, collection: 'Travel', chapters: [{ title: 'Start', start: 0 }], bookmarks: [{ id: 'b', label: '', note: 'note', page: 4, createdAt: 10 }] }] }))
    expect(await db.texts.get(1)).toMatchObject({ syncId: 'stable', readingPage: 4, collection: 'Travel' })
    expect(await db.texts.get(90)).toBeUndefined()
  })
  it('propagates deletions without resurrecting old backups, while allowing deliberate re-addition', async () => {
    await db.texts.put(document(1, 'stable'))
    await setWordStatus('en', 'cat', 'learning')
    const old = await createBackup()
    await deleteText(document(1, 'stable'))
    await deleteWord('en:cat')
    const removed = await createBackup()
    await mergeBackup(old)
    expect(await db.texts.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    await db.delete(); await db.open()
    await mergeBackup(old)
    await mergeBackup(removed)
    expect(await db.texts.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    await db.words.put({ ...old.words[0], updatedAt: Date.now() + 100 })
    await mergeBackup(removed)
    expect(await db.words.count()).toBe(1)
  })
  it('rejects malformed new metadata before importing any record', () => {
    for (const change of [{ readingStatus: 'invalid' }, { chapters: [{ title: 'bad', start: 999 }] }, { bookmarks: [{ id: 'x', page: -1, label: '', note: '', createdAt: 1 }] }]) expect(() => parseBackup({ ...base(), texts: [{ ...document(1, 'stable'), ...change }] })).toThrow()
  })
})

it('combines independent bookmarks and propagates note deletion even when reading position is newer', async () => {
  const note = (id: string, updatedAt: number) => ({ id, page: 0, label: id, note: id, createdAt: 1, updatedAt })
  await db.texts.put({ ...document(1, 'stable', 100), bookmarks: [note('local', 10), note('removed', 20)] })
  await mergeBackup({ ...base(), texts: [{ ...document(9, 'stable', 50), bookmarks: [note('remote', 30)], bookmarkDeletions: [{ id: 'removed', deletedAt: 40 }] }] })
  expect((await db.texts.get(1))?.bookmarks?.map((note) => note.id)).toEqual(['local', 'remote'])
  await mergeBackup({ ...base(), texts: [{ ...document(9, 'stable', 1), bookmarks: [note('removed', 20)] }] })
  expect((await db.texts.get(1))?.bookmarks?.map((note) => note.id)).toEqual(['local', 'remote'])
})

it('does not resurrect a tombstoned PDF binary from a stale backup', async () => {
  const pdf = { ...document(1, 'pdf'), kind: 'pdf' as const, fileId: 'file' }
  await db.texts.put(pdf)
  await db.files.put({ id: 'file', name: 'book.pdf', type: 'application/pdf', createdAt: 1, blob: new Blob(['%PDF-']) })
  const stale: Backup = { ...base(), texts: [pdf], files: [{ id: 'file', name: 'book.pdf', type: 'application/pdf', createdAt: 1, data: 'data:application/pdf;base64,JVBERi0=' }] }
  await deleteText(pdf)
  await mergeBackup(stale)
  expect(await db.texts.count()).toBe(0)
  expect(await db.files.count()).toBe(0)
})

it('keeps the latest FSRS review when a stale device only adds a newer encounter', async () => {
  await setWordStatus('en', 'cat', 'learning')
  const original = (await db.words.get('en:cat'))!
  const fresh = { ...original, card: { ...original.card!, last_review: new Date(300), reps: 2 }, updatedAt: 300 }
  await db.words.put(fresh)
  await mergeBackup({ ...base(), words: [{ ...original, card: { ...original.card!, last_review: new Date(100), reps: 1 }, contexts: [{ id: 'c', sentence: 'A cat.', seenAt: 500 }], updatedAt: 500 }] })
  expect((await db.words.get('en:cat'))?.card?.reps).toBe(2)
  expect((await db.words.get('en:cat'))?.contexts).toHaveLength(1)
})

it('stopping while decryption finishes prevents local merge and upload', async () => {
  const remote = await encryptBackup({ ...base(), texts: [document(1, 'remote')] }, passphrase)
  const controller = new AbortController()
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle)
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args: Parameters<SubtleCrypto['decrypt']>) => {
    const result = await decrypt(...args)
    controller.abort()
    return result
  })
  const fetch = vi.fn().mockResolvedValue(new Response(remote, { headers: { ETag: '"one"' } }))
  vi.stubGlobal('fetch', fetch)
  await expect(syncWithServer(connection, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(await db.texts.count()).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})

describe('independent word status clocks', () => {
  it.each(['known', 'ignored'] as const)('does not let a stale device’s newer encounter undo an explicit %s status', async (status) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    await setWordStatus('en', 'cat', 'learning')
    const original = (await db.words.get('en:cat'))!
    vi.setSystemTime(2000)
    await setWordStatus('en', 'cat', status)
    const decided = (await db.words.get('en:cat'))!
    // A second device still has the old learning status, but reads the word later.
    await db.words.put(original)
    vi.setSystemTime(3000)
    await rememberContext('en', 'cat', 'A cat sleeps.', { id: 'book', title: 'Book' })
    const encountered = (await db.words.get('en:cat'))!
    expect(encountered.statusAt).toBe(1000)
    await db.words.put(decided)
    await mergeBackup({ ...base(), words: [encountered] })
    const merged = (await db.words.get('en:cat'))!
    expect(merged).toMatchObject({ status, statusAt: 2000, updatedAt: 3000 })
    expect(merged.contexts?.[0].sentence).toBe('A cat sleeps.')
    expect(merged.card).toBeUndefined()
    // The same merge in the other direction reaches the same status and schedule.
    await db.words.put(encountered)
    await mergeBackup({ ...base(), words: [decided] })
    expect(await db.words.get('en:cat')).toEqual(merged)
  })

  it('lets a later deliberate learning decision win over newer non-status data', async () => {
    const known: WordEntry = { key: 'en:cat', language: 'en', term: 'cat', status: 'known', statusAt: 2000, createdAt: 1000, updatedAt: 5000, translation: 'kedi' }
    const learning: WordEntry = { ...known, status: 'learning', statusAt: 3000, updatedAt: 3000, card: newCard(new Date(3000)), translation: undefined }
    await db.words.put(known)
    await mergeBackup({ ...base(), words: [learning] })
    expect(await db.words.get('en:cat')).toMatchObject({ status: 'learning', statusAt: 3000, updatedAt: 5000, translation: 'kedi', card: learning.card })
    const merged = (await db.words.get('en:cat'))!
    await db.words.put(learning)
    await mergeBackup({ ...base(), words: [known] })
    expect(await db.words.get('en:cat')).toEqual(merged)
  })

  it('resolves simultaneous conflicting status decisions identically on both devices', async () => {
    const known: WordEntry = { key: 'en:cat', language: 'en', term: 'cat', status: 'known', statusAt: 2000, createdAt: 1000, updatedAt: 2000 }
    const learning: WordEntry = { ...known, status: 'learning', card: newCard(new Date(2000)) }
    await db.words.put(known)
    await mergeBackup({ ...base(), words: [learning] })
    const first = (await db.words.get('en:cat'))!
    await db.words.put(learning)
    await mergeBackup({ ...base(), words: [known] })
    const second = (await db.words.get('en:cat'))!
    expect(second).toEqual(first)
    expect(second.status).toBe('known')
    expect(second.card).toBeUndefined()
  })

  it('preserves a same-millisecond delete and intentional re-add through subsequent edits and sync', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    await setWordStatus('en', 'cat', 'learning')
    await deleteWord('en:cat')
    const removed = await createBackup()
    const deletionTime = removed.tombstones![0].updatedAt
    await setWordStatus('en', 'cat', 'known')
    await saveExplanation('en', 'cat', { lemma: 'cat', partOfSpeech: 'noun', translation: 'kedi', meaning: '', grammar: '', example: '', exampleTranslation: '' }, 'A cat.')
    const readded = await createBackup()
    expect(readded.words[0].updatedAt).toBeGreaterThan(deletionTime)
    expect(readded.words[0].statusAt).toBeGreaterThan(deletionTime)
    await mergeBackup(removed)
    expect(await db.words.get('en:cat')).toMatchObject({ status: 'known', translation: 'kedi' })
    await db.delete(); await db.open()
    await mergeBackup(removed)
    await mergeBackup(readded)
    expect((await db.words.get('en:cat'))?.status).toBe('known')
    // A second explicit deletion in that same tick must still sort after the re-add.
    await deleteWord('en:cat')
    await mergeBackup(readded)
    expect(await db.words.get('en:cat')).toBeUndefined()
  })

  it('round-trips the optional status clock and rejects invalid timestamps', () => {
    const word: WordEntry = { key: 'en:cat', language: 'en', term: 'cat', status: 'known', statusAt: 1000, createdAt: 1, updatedAt: 2000 }
    expect(parseBackup({ ...base(), words: [word] }).words[0].statusAt).toBe(1000)
    expect(parseBackup({ ...base(), words: [{ ...word, statusAt: undefined }] }).words[0].statusAt).toBeUndefined()
    for (const statusAt of [-1, '1000', null, Infinity]) expect(() => parseBackup({ ...base(), words: [{ ...word, statusAt }] })).toThrow()
  })
})
