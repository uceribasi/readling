import { afterEach, describe, expect, it, vi } from 'vitest'
import { translateWithBuiltin } from './builtin'
import { cleanPlainReply, sentencePrompt } from './types'

type Global = { LanguageModel?: unknown; Translator?: unknown }

afterEach(() => {
  delete (globalThis as Global).LanguageModel
  delete (globalThis as Global).Translator
})

describe('sentence translation', () => {
  it('asks for the translation only, in the learner’s language', () => {
    const prompt = sentencePrompt({ sentence: 'Marlo subía la escalera.', language: 'es', target: 'tr' })
    expect(prompt.system).toContain('Spanish')
    expect(prompt.system).toContain('natural Turkish')
    expect(prompt.user).toBe('Marlo subía la escalera.')
  })

  it('strips quotes, code fences and reasoning from plain replies', () => {
    expect(cleanPlainReply('“Marlo merdivenden çıkıyordu.”')).toBe('Marlo merdivenden çıkıyordu.')
    expect(cleanPlainReply('<think>hmm</think>\n```\nHello there.\n```')).toBe('Hello there.')
    expect(cleanPlainReply('He said "hi" to her.')).toBe('He said "hi" to her.')
  })

  it('uses the on-device translator when it supports the pair', async () => {
    ;(globalThis as Global).Translator = {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => ({ translate: async (text: string) => `[tr] ${text}` })),
    }
    expect(await translateWithBuiltin('Hola.', 'es', 'tr')).toBe('[tr] Hola.')
  })

  it('asks for the model download when nothing else can translate', async () => {
    ;(globalThis as Global).LanguageModel = { availability: async () => 'downloadable', create: vi.fn() }
    await expect(translateWithBuiltin('Hola.', 'es', 'ko')).rejects.toMatchObject({ code: 'builtin-download' })
  })
})
