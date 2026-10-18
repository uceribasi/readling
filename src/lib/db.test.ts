import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, recordQuizAnswer, saveExplanation, setWordStatus } from './db'

beforeEach(async () => {
  await db.delete()
  await db.open()
})
afterEach(() => vi.useRealTimers())

describe('vocabulary persistence', () => {
  it('keeps each explanation paired with the sentence it describes', async () => {
    await setWordStatus('en', 'bank', 'learning', 'She deposited money at the bank.')
    const explanation = { lemma: 'bank', partOfSpeech: 'noun', translation: 'nehir kıyısı', meaning: '', grammar: '', example: '', exampleTranslation: '' }
    await saveExplanation('en', 'bank', explanation, 'We sat on the river bank.')
    await setWordStatus('en', 'bank', 'known', 'She works at a bank.')
    expect(await db.words.get('en:bank')).toMatchObject({ context: 'We sat on the river bank.', explanation, translation: 'nehir kıyısı' })
  })

  it('adds a context when a previously known word is put into learning', async () => {
    await setWordStatus('en', 'bank', 'known')
    await setWordStatus('en', 'bank', 'learning', 'We sat on the river bank.')
    expect((await db.words.get('en:bank'))?.context).toBe('We sat on the river bank.')
  })

  it('advances the backup timestamp when a test answer is saved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    await setWordStatus('en', 'bank', 'learning')
    vi.setSystemTime(2000)
    await recordQuizAnswer('en:bank', true)
    expect(await db.words.get('en:bank')).toMatchObject({ updatedAt: 2000, quiz: { correct: 1, wrong: 0, lastAt: 2000 } })
  })
})
