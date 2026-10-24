import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExtensionLookupHandler, parseExtensionLookup } from './extensionLookup'

const now = 1_700_000_000_000
const request = { version: 1, action: 'explain', id: '12345678-1234-1234-1234-123456789012', createdAt: now, surface: 'Bank', sentence: 'We sat on the river bank.', url: 'https://example.org/article', title: 'A walk', language: 'en-US' }
const explanation = { lemma: 'bank', partOfSpeech: 'noun', translation: 'kıyı', meaning: 'A river bank.', grammar: '', example: 'We sat on the bank.', exampleTranslation: 'Kıyıya oturduk.' }
const dependencies = () => ({ settings: () => ({ explanationLanguage: 'tr', lastTextLanguage: 'de' }), explain: vi.fn(async () => explanation), save: vi.fn(async () => {}), now: () => now })

afterEach(() => vi.useRealTimers())

describe('extension request validation', () => {
  it('normalizes supported source language and strips unrelated payload fields', () => {
    expect(parseExtensionLookup({ ...request, apiKeys: 'not accepted' }, now)).toEqual({ ...request, language: 'en' })
    expect(parseExtensionLookup({ ...request, language: 'xx' }, now)?.language).toBeUndefined()
  })
  it.each([
    null, [], {}, { ...request, version: 2 }, { ...request, id: 'short' }, { ...request, action: 'save' },
    { ...request, createdAt: now - 300_001 }, { ...request, createdAt: now + 10_001 }, { ...request, createdAt: NaN },
    { ...request, surface: '' }, { ...request, surface: '123' }, { ...request, surface: 'x'.repeat(161) },
    { ...request, sentence: 'x'.repeat(2001) }, { ...request, sentence: '' }, { ...request, title: 'x'.repeat(301) },
    { ...request, url: 'javascript:alert(1)' }, { ...request, url: 'file:///private/key' }, { ...request, url: 'https://user:pass@example.org/' },
  ])('rejects malformed, oversized, stale and non-web requests', (value) => expect(parseExtensionLookup(value, now)).toBeNull())
})

describe('one-shot app bridge', () => {
  it('explains only on explicit invocation, returns bounded fields, and saves only on the save action', async () => {
    const deps = dependencies()
    deps.explain.mockResolvedValue({ ...explanation, meaning: 'x'.repeat(2_000) })
    const bridge = createExtensionLookupHandler(deps)
    expect(deps.explain).not.toHaveBeenCalled()
    const response = await bridge.handle(request)
    expect(response).toMatchObject({ ok: true, surface: 'Bank', language: 'en', saved: false, translation: 'kıyı' })
    expect(response).not.toHaveProperty('apiKeys')
    if (response.ok) expect(response.meaning).toHaveLength(1500)
    expect(deps.explain).toHaveBeenCalledWith(expect.objectContaining({ term: 'bank', explanationLanguage: 'tr', language: 'en' }), expect.any(AbortSignal))
    expect(deps.save).not.toHaveBeenCalled()
    expect(await bridge.handle({ version: 1, action: 'save', id: request.id })).toMatchObject({ ok: true, saved: true })
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ term: 'bank', url: request.url, title: 'A walk' }), expect.objectContaining({ translation: 'kıyı' }))
    await bridge.handle({ version: 1, action: 'save', id: request.id })
    expect(deps.save).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })
  it('reuses an identical request but rejects another source under the same ID', async () => {
    const deps = dependencies()
    const bridge = createExtensionLookupHandler(deps)
    await bridge.handle(request)
    expect(await bridge.handle(request)).toMatchObject({ ok: true })
    expect(await bridge.handle({ ...request, sentence: 'Changed.' })).toMatchObject({ ok: false, error: 'invalid' })
    expect(deps.explain).toHaveBeenCalledTimes(1)
    bridge.dispose()
  })
  it('rejects unsolicited saves, expired results, and disposed handlers', async () => {
    const deps = dependencies()
    let clock = now
    deps.now = () => clock
    const bridge = createExtensionLookupHandler(deps)
    expect(await bridge.handle({ version: 1, action: 'save', id: request.id })).toMatchObject({ error: 'expired' })
    await bridge.handle(request)
    clock += 300_001
    expect(await bridge.handle({ version: 1, action: 'save', id: request.id })).toMatchObject({ error: 'expired' })
    expect(deps.save).not.toHaveBeenCalled()
    bridge.dispose()
    expect(await bridge.handle({ ...request, createdAt: clock })).toMatchObject({ error: 'expired' })
  })
  it('allows only one model request at a time and aborts on timeout even if a provider ignores cancellation', async () => {
    vi.useFakeTimers()
    const deps = dependencies()
    deps.explain.mockImplementation(() => new Promise(() => {}))
    const bridge = createExtensionLookupHandler(deps)
    const pending = bridge.handle(request)
    expect(await bridge.handle({ ...request, id: '12345678-1234-1234-1234-123456789013' })).toMatchObject({ error: 'busy' })
    await vi.advanceTimersByTimeAsync(45_000)
    expect(await pending).toMatchObject({ error: 'timeout' })
    const signal = (deps.explain.mock.calls[0] as unknown as [unknown, AbortSignal])[1]
    expect(signal.aborted).toBe(true)
    bridge.dispose()
  })
  it('uses the app language fallback and never leaks raw provider errors', async () => {
    const deps = dependencies()
    const bridge = createExtensionLookupHandler(deps)
    deps.explain.mockRejectedValueOnce(new Error('Secret token abc123 in error body'))
    const response = await bridge.handle({ ...request, language: '' })
    expect(response).toEqual({ version: 1, id: request.id, ok: false, error: 'failed' })
    expect(deps.explain).toHaveBeenCalledWith(expect.objectContaining({ language: 'de' }), expect.any(AbortSignal))
    bridge.dispose()
  })
  it('stores selections using the same word and phrase keys as the reader', async () => {
    const deps = dependencies()
    const bridge = createExtensionLookupHandler(deps)
    await bridge.handle({ ...request, surface: 'Bank,' })
    expect(deps.explain).toHaveBeenLastCalledWith(expect.objectContaining({ term: 'bank' }), expect.any(AbortSignal))
    await bridge.handle({ ...request, id: '12345678-1234-1234-1234-123456789013', surface: 'Give   up!' })
    expect(deps.explain).toHaveBeenLastCalledWith(expect.objectContaining({ term: 'give up' }), expect.any(AbortSignal))
    await bridge.handle({ ...request, id: '12345678-1234-1234-1234-123456789014', surface: '私は学生です', language: 'ja' })
    expect(deps.explain).toHaveBeenLastCalledWith(expect.objectContaining({ term: '私 は 学生 です' }), expect.any(AbortSignal))
    expect(await bridge.handle({ ...request, id: '12345678-1234-1234-1234-123456789015', surface: 'a b c d e f g h i' })).toMatchObject({ error: 'invalid' })
    expect(deps.explain).toHaveBeenCalledTimes(3)
    bridge.dispose()
  })
})
