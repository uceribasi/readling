import { afterEach, describe, expect, it, vi } from 'vitest'
import { builtinStatus, builtinSupported, explainWithBuiltin, TIMEOUTS } from './builtin'
import { AiError, type ExplainRequest } from './types'

const english = {
  lemma: 'escalera',
  partOfSpeech: 'noun',
  translation: 'staircase',
  meaning: 'The stairs of the lighthouse.',
  grammar: 'Feminine noun.',
  example: 'La escalera es estrecha.',
  exampleTranslation: 'The staircase is narrow.',
}

const request: ExplainRequest = {
  term: 'escalera',
  surface: 'escalera',
  sentence: 'Marlo subía la escalera.',
  language: 'es',
  explanationLanguage: 'tr',
}

type Global = { LanguageModel?: unknown; Translator?: unknown }

function mockLanguageModel(outputLanguages: string[], reply: object) {
  const prompts: { system?: string; user: string; output: string }[] = []
  ;(globalThis as Global).LanguageModel = {
    availability: vi.fn(async (options: { expectedOutputs: { languages: string[] }[] }) =>
      outputLanguages.includes(options.expectedOutputs[0].languages[0]) ? 'available' : 'unavailable',
    ),
    create: vi.fn(async (options: { initialPrompts: { content: string }[]; expectedOutputs: { languages: string[] }[] }) => ({
      prompt: async (user: string) => {
        prompts.push({ system: options.initialPrompts[0]?.content, user, output: options.expectedOutputs[0].languages[0] })
        return JSON.stringify(reply)
      },
      destroy: () => {},
    })),
  }
  return prompts
}

function mockTranslator(pairs: string[]) {
  const calls: string[] = []
  ;(globalThis as Global).Translator = {
    availability: vi.fn(async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) =>
      pairs.includes(`${sourceLanguage}>${targetLanguage}`) ? 'downloadable' : 'unavailable',
    ),
    create: vi.fn(async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => ({
      translate: async (text: string) => {
        calls.push(`${sourceLanguage}>${targetLanguage}:${text}`)
        return `[${targetLanguage}] ${text}`
      },
    })),
  }
  return calls
}

afterEach(() => {
  delete (globalThis as Global).LanguageModel
  delete (globalThis as Global).Translator
})

describe('explainWithBuiltin', () => {
  it('reports support only when the browser has an on-device API', () => {
    expect(builtinSupported()).toBe(false)
    mockTranslator([])
    expect(builtinSupported()).toBe(true)
  })

  it('lets Gemini Nano explain directly when it can write the learner’s language', async () => {
    const prompts = mockLanguageModel(['en', 'es', 'de'], english)
    const result = await explainWithBuiltin({ ...request, language: 'en', explanationLanguage: 'de' })
    expect(result.translation).toBe('staircase')
    expect(prompts).toHaveLength(1)
    expect(prompts[0].output).toBe('de')
    expect(prompts[0].system).toContain('German')
  })

  it('explains in English and translates when the learner’s language is not supported by the model', async () => {
    const prompts = mockLanguageModel(['en'], english)
    const calls = mockTranslator(['en>tr'])
    const result = await explainWithBuiltin(request)
    expect(prompts[0].output).toBe('en')
    expect(result.translation).toBe('[tr] staircase')
    expect(result.meaning).toBe('[tr] The stairs of the lighthouse.')
    expect(result.example).toBe('La escalera es estrecha.') // stays in the language being learned
    expect(calls.every((call) => call.startsWith('en>tr:'))).toBe(true)
  })

  it('falls back to translating the word and its sentence', async () => {
    const calls = mockTranslator(['es>tr'])
    const result = await explainWithBuiltin(request)
    expect(result.translation).toBe('[tr] escalera')
    expect(result.meaning).toBe('“[tr] Marlo subía la escalera.”')
    expect(calls).toHaveLength(2)
  })

  it('says so when nothing can help', async () => {
    mockTranslator([])
    await expect(explainWithBuiltin(request)).rejects.toMatchObject({ code: 'builtin-unavailable' })
  })

  it('asks for a click when the download needs user activation', async () => {
    ;(globalThis as Global).Translator = {
      availability: async () => 'downloadable',
      create: async () => {
        throw new DOMException('Requires a user gesture', 'NotAllowedError')
      },
    }
    // A pair no earlier test used, so no translator is cached for it yet.
    const error = await explainWithBuiltin({ ...request, language: 'it', term: 'altra', surface: 'altra' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiError)
    expect((error as AiError).code).toBe('builtin-activation')
  })

  it('waits for the person to download Gemini Nano instead of starting it from a word click', async () => {
    const create = vi.fn()
    ;(globalThis as Global).LanguageModel = { availability: async () => 'downloadable', create }
    await expect(explainWithBuiltin(request)).rejects.toMatchObject({ code: 'builtin-download' })
    expect(create).not.toHaveBeenCalled()
  })

  it('treats a browser that never answers as unavailable', async () => {
    vi.useFakeTimers()
    try {
      const never = () => new Promise<never>(() => {})
      ;(globalThis as Global).LanguageModel = { availability: never, create: never }
      ;(globalThis as Global).Translator = { availability: never, create: never }
      const status = builtinStatus('es', 'tr')
      const explanation = explainWithBuiltin(request).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(TIMEOUTS.availability * 5)
      expect(await status).toEqual({ prompt: 'unavailable', translator: 'unavailable' })
      expect(await explanation).toMatchObject({ code: 'builtin-unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })
})
