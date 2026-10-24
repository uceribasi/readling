import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, markUntrackedAsKnown, queueForReview, recordQuizAnswer, rememberContext, saveExplanation, saveReviewedCard, setWordStatus } from './db'
import { newCard } from './srs'
import { saveWordFamily } from './vocabulary'

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

  const edits: [string, () => Promise<void>][] = [
    ['quiz answers', () => recordQuizAnswer('en:bank', true)],
    ['reviews', () => saveReviewedCard('en:bank', newCard(new Date()))],
    ['encounters', () => rememberContext('en', 'bank', `A bank at ${Date.now()}.`)],
    ['explanations', () => saveExplanation('en', 'bank', { lemma: 'bank', partOfSpeech: 'noun', translation: 'banka', meaning: '', grammar: '', example: '', exampleTranslation: '' }, 'A bank.')],
    ['word families', () => saveWordFamily('en:bank', 'bank')],
  ]
  it.each(edits)('keeps the legacy status clock independent of %s', async (_, edit) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await db.words.put({ key: 'en:bank', language: 'en', term: 'bank', status: 'learning', createdAt: 1000, updatedAt: 1000, card: newCard(new Date(1000)) })
    vi.setSystemTime(2000)
    await edit()
    expect(await db.words.get('en:bank')).toMatchObject({ statusAt: 1000, updatedAt: 2000 })
    vi.setSystemTime(3000)
    await edit()
    expect(await db.words.get('en:bank')).toMatchObject({ statusAt: 1000, updatedAt: 3000 })
  })

  it('records page completion and deliberate re-queueing as explicit status decisions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1000)
    await markUntrackedAsKnown('en', ['bank'])
    expect(await db.words.get('en:bank')).toMatchObject({ status: 'known', statusAt: 1000 })
    await queueForReview(['en:bank'])
    const queued = (await db.words.get('en:bank'))!
    expect(queued.status).toBe('learning')
    expect(queued.statusAt).toBeGreaterThan(1000)
    expect(queued.card).toBeDefined()
  })

  it('does not attach a stale review card after the word has become known', async () => {
    await setWordStatus('en', 'bank', 'known')
    await saveReviewedCard('en:bank', newCard())
    expect((await db.words.get('en:bank'))?.card).toBeUndefined()
  })
})
