import { describe, expect, it } from 'vitest'
import { dayKey, type TextDoc, type WordEntry } from './db'
import { createDailySession, dailyExcerpt, dailyLimits, loadDailyGoal, loadDailySession, parseDailySession, practiceWords, recommendTexts, saveDailyGoal, saveDailySession, wordsForText, wordsInText } from './daily'
import { newCard } from './srs'

const now = new Date(2026, 9, 20, 12).getTime()
function word(term: string, patch: Partial<WordEntry> = {}): WordEntry {
  return { key: `en:${term}`, language: 'en', term, status: 'learning', translation: term, createdAt: now, updatedAt: now, ...patch }
}
function text(id: number, content: string, patch: Partial<TextDoc> = {}): TextDoc {
  return { id, title: `Text ${id}`, language: 'en', content, createdAt: now, updatedAt: now, ...patch }
}
function storage() {
  const entries = new Map<string, string>()
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
}

describe('practice vocabulary selection', () => {
  it('keeps recent, weak and due selections distinct without mutating the input', () => {
    const words = [
      word('new', { createdAt: now + 1 }),
      word('weak', { status: 'known', quiz: { correct: 1, wrong: 4, lastAt: now } }),
      word('due', { card: newCard(new Date(now - 1000)) }),
      word('later', { card: newCard(new Date(now + 1000)) }),
      word('ignored', { status: 'ignored', quiz: { correct: 0, wrong: 3, lastAt: now } }),
    ]
    expect(practiceWords(words, 'recent', 1, now).map((item) => item.term)).toEqual(['new'])
    expect(practiceWords(words, 'weak', 10, now).map((item) => item.term)).toEqual(['weak'])
    expect(practiceWords(words, 'due', 10, now).map((item) => item.term)).toEqual(['due'])
    expect(words[0].term).toBe('new')
  })

  it('matches saved whole words and phrases in the selected text and language', () => {
    const words = [word('art'), word('cart'), word('give up'), word('ignored', { status: 'ignored' }), word('bonjour', { key: 'fr:bonjour', language: 'fr' })]
    expect(wordsInText('Take the cart. Never give up! Bonjour, ignored.', 'en', words).map((item) => item.term)).toEqual(['cart', 'give up'])
    expect(wordsInText('I give. Up the stairs.\n\nGive\n\nup.', 'en', words)).toEqual([])
  })

  it('handles Turkish case and Japanese terms', () => {
    expect(wordsInText('IŞIK', 'tr', [word('ışık', { key: 'tr:ışık', language: 'tr' })])).toHaveLength(1)
    expect(wordsInText('猫がいます。', 'ja', [word('猫', { key: 'ja:猫', language: 'ja' })])).toHaveLength(1)
  })

  it('includes PDF encounters beyond its preview and uses that source’s translation', () => {
    const pdf = text(1, 'Introduction.', { kind: 'pdf', syncId: 'document-one' })
    const bank = word('bank', { translation: 'financial bank', contexts: [
      { id: 'encounter-one', sentence: 'We sat on the river bank.', translation: 'river side', source: { id: 'document-one', title: pdf.title }, seenAt: now },
      { id: 'encounter-two', sentence: 'I visited a bank.', translation: 'financial bank', source: { id: 'document-two', title: 'Another text' }, seenAt: now + 1 },
    ] })
    const scoped = wordsForText(pdf, [bank, word('absent')])
    expect(scoped).toHaveLength(1)
    expect(scoped[0].translation).toBe('river side')
    expect(scoped[0].context).toBe('We sat on the river bank.')
    expect(bank.translation).toBe('financial bank')
  })
})

describe('reading recommendations', () => {
  it('favors approachable reading with due vocabulary and excludes PDF previews and other languages', () => {
    const texts = [text(1, 'A cat sleeps here.'), text(2, 'Astronomical computation requires complex theory.'), text(3, 'A cat sleeps here.', { kind: 'pdf' }), text(4, 'A cat sleeps here.', { language: 'fr' })]
    const words = ['a', 'cat', 'sleeps'].map((term) => word(term, { status: 'known' }))
    words.push(word('here', { card: newCard(new Date(now - 1000)) }))
    const recommendations = recommendTexts(texts, words, { language: 'en', now })
    expect(recommendations.map((item) => item.text.id)).toEqual([1, 2])
    expect(recommendations[0].coverage).toBe(0.75)
    expect(recommendations[0].practiceTerms).toBe(1)
    expect(recommendations[0].wordCount).toBe(4)
  })

  it('prefers a shorter text when coverage and useful words are equal', () => {
    expect(recommendTexts([text(1, 'cat '.repeat(1000)), text(2, 'cat')], [word('cat', { status: 'known' })], { maxWords: 350 })[0].text.id).toBe(2)
  })
})

describe('daily sessions', () => {
  it('uses at most five due reviews and three practice words for the default goal', () => {
    const words = Array.from({ length: 12 }, (_, i) => word(`term${i}`, { card: newCard(new Date(now - 1000 - i)) }))
    const session = createDailySession([text(1, 'term5 term6 term7.')], words, 'en', 10, now)
    expect(session.reviewKeys).toHaveLength(5)
    expect(session.quizKeys).toEqual(['en:term5', 'en:term6', 'en:term7'])
    expect(session.stage).toBe('review')
    expect(session.textId).toBe(1)
    expect(session.date).toBe(dayKey(now))
    expect(dailyLimits(5).reviews).toBeLessThan(dailyLimits(15).reviews)
  })

  it('creates a usable empty session without inventing exercises', () => {
    const session = createDailySession([], [word('untranslated', { translation: undefined })], 'en', 10, now)
    expect(session.reviewKeys).toEqual([])
    expect(session.quizKeys).toEqual([])
    expect(session.textId).toBeUndefined()
  })

  it('resumes the saved stage independently for each day and language', () => {
    const target = storage()
    const session = { ...createDailySession([], [], 'en', 15, now), stage: 'quiz' as const }
    saveDailySession(session, target)
    expect(loadDailySession('en', dayKey(now), target)).toEqual(session)
    expect(loadDailySession('fr', dayKey(now), target)).toBeUndefined()
    expect(loadDailySession('en', dayKey(now + 86_400_000), target)).toBeUndefined()
    saveDailyGoal(15, target)
    expect(loadDailyGoal(target)).toBe(15)
  })

  it('rejects malformed or foreign progress instead of trusting local storage', () => {
    const valid = createDailySession([], [word('cat', { card: newCard(new Date(now)) })], 'en', 10, now)
    const parse = (patch: object) => parseDailySession({ ...valid, ...patch }, 'en', dayKey(now))
    expect(parse({ goal: 500 })).toBeUndefined()
    expect(parse({ date: '2020-01-01' })).toBeUndefined()
    expect(parse({ stage: 'unknown' })).toBeUndefined()
    expect(parse({ textId: -1 })).toBeUndefined()
    expect(parse({ reviewedKeys: ['en:missing'] })).toBeUndefined()
    expect(parse({ reviewKeys: ['fr:cat'] })).toBeUndefined()
    expect(parse({ answers: [{ key: 'en:cat', correct: true }, { key: 'en:cat', correct: false }] })).toBeUndefined()
    expect(parse({ answers: [{ key: 'en:cat', correct: 'yes' }] })).toBeUndefined()
  })

  it('bounds long passages while preserving complete sentences when possible', () => {
    expect(dailyExcerpt('One two. Three four. Five six.', 'en', 4)).toBe('One two. Three four.')
    expect(dailyExcerpt('word '.repeat(2000), 'en', 100).split(' ')).toHaveLength(100)
    expect(dailyExcerpt('', 'en', 100)).toBe('')
  })
})
