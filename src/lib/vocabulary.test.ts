import { describe, expect, it } from 'vitest'
import { appendContext, type WordEntry } from './db'
import { mergeContexts, relatedWords } from './vocabulary'
const word: WordEntry = { key: 'en:went', language: 'en', term: 'went', status: 'learning', createdAt: 1, updatedAt: 1, family: 'go' }
describe('vocabulary memory', () => {
  it('preserves the old meaning when a new context is saved', () => {
    const bank = { ...word, context: 'She went to the bank.', translation: 'banka' }
    const contexts = appendContext(bank, 'They sat on the river bank.', undefined, { id: 'book', title: 'Book' })
    expect(contexts.map((c) => c.sentence)).toEqual(['She went to the bank.', 'They sat on the river bank.'])
    expect(contexts[0].translation).toBe('banka')
  })
  it('enriches an encounter with its source instead of duplicating it', () => {
    const first = appendContext(word, 'We went home.')
    const next = appendContext({ ...word, contexts: first }, 'We went home.', undefined, { id: 'text', title: 'Home' })
    expect(next).toHaveLength(1)
    expect(next[0].source?.id).toBe('text')
    expect(mergeContexts(next, next)).toHaveLength(1)
  })
  it('groups corrected families only within the same language, without changing status', () => {
    const go = { ...word, key: 'en:go', term: 'go', status: 'known' as const }
    const foreign = { ...go, language: 'de', key: 'de:go' }
    expect(relatedWords(word, [word, go, foreign])).toEqual([go])
    expect(word.status).toBe('learning')
  })
})

it('merges corrected encounters by edit time, independently of device order', () => {
  const older = { id: 'a', sentence: 'A bank.', translation: 'banka', seenAt: 1, updatedAt: 10, source: { id: 'source', title: 'Book' } }
  const newer = { ...older, id: 'b', translation: 'kıyı', seenAt: 2, updatedAt: 20 }
  expect(mergeContexts([older], [newer])).toEqual(mergeContexts([newer], [older]))
  expect(mergeContexts([newer], [older])[0].translation).toBe('kıyı')
})
