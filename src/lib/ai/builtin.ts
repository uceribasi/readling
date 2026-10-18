/**
 * The browser's own on-device AI (Chrome): free, offline after the first download,
 * and nothing leaves the computer.
 *
 * - Prompt API (Gemini Nano) writes full explanations, but only in a few languages
 *   and on capable hardware.
 * - Translator API covers many more languages and lighter machines, but only translates.
 *
 * explainWithBuiltin uses the best combination that's available.
 */
import {
  AiError,
  buildPrompt,
  EXPLANATION_SCHEMA,
  parseExplanation,
  sentencePrompt,
  type Completion,
  type ExplainRequest,
  type Explanation,
} from './types'

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>
  destroy(): void
}
interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void
}
interface LanguageModelOptions {
  initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[]
  expectedInputs?: { type: 'text'; languages: string[] }[]
  expectedOutputs?: { type: 'text'; languages: string[] }[]
  monitor?: (monitor: DownloadMonitor) => void
  signal?: AbortSignal
}
interface LanguageModelApi {
  availability(options?: LanguageModelOptions): Promise<Availability>
  create(options?: LanguageModelOptions): Promise<LanguageModelSession>
}
interface TranslatorInstance {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>
}
interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>
  create(options: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal }): Promise<TranslatorInstance>
}

/** Languages the Prompt API can write in (Chrome docs, 2026). */
const PROMPT_LANGUAGES = new Set(['en', 'ja', 'es', 'de', 'fr'])

/** Some browsers expose these APIs but never answer; don't let that freeze the reader. */
export const TIMEOUTS = { availability: 4_000, download: 120_000, answer: 90_000 }

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => Promise.resolve().then(onTimeout).then(resolve, reject), ms)
    }),
  ])
}

function timedOut(): never {
  throw new AiError('timeout')
}

function languageModel(): LanguageModelApi | undefined {
  return (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel
}

function translatorApi(): TranslatorApi | undefined {
  return (globalThis as { Translator?: TranslatorApi }).Translator
}

/** True if this browser has any on-device AI at all (a quick, synchronous check). */
export function builtinSupported(): boolean {
  return Boolean(languageModel() || translatorApi())
}

export interface BuiltinStatus {
  prompt: Availability | 'unsupported'
  translator: Availability | 'unsupported'
}

/** What's available for reading `language` with explanations in `explanationLanguage`. */
export async function builtinStatus(language: string, explanationLanguage: string): Promise<BuiltinStatus> {
  const lm = languageModel()
  const tr = translatorApi()
  const output = PROMPT_LANGUAGES.has(explanationLanguage) ? explanationLanguage : 'en'
  return {
    prompt: lm ? await checkAvailability(lm.availability(promptOptions([language], output))) : 'unsupported',
    translator:
      tr && language !== explanationLanguage
        ? await checkAvailability(tr.availability({ sourceLanguage: language, targetLanguage: explanationLanguage }))
        : 'unsupported',
  }
}

function checkAvailability(promise: Promise<Availability>): Promise<Availability> {
  return withTimeout(promise.catch(() => 'unavailable' as const), TIMEOUTS.availability, () => 'unavailable' as const)
}

/**
 * Downloads Gemini Nano. It's a large one-time download, so it only starts when the
 * person asks for it in Settings, never from clicking a word.
 */
export async function downloadPromptModel(onProgress: (loaded: number) => void): Promise<void> {
  const lm = languageModel()
  if (!lm) throw new AiError('builtin-unavailable')
  try {
    const session = await lm.create({
      ...promptOptions([], 'en'),
      monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => onProgress(event.loaded)),
    })
    session.destroy()
  } catch (error) {
    throw toAiError(error)
  }
}

function promptOptions(inputLanguages: string[], outputLanguage: string): LanguageModelOptions {
  return {
    expectedInputs: [{ type: 'text', languages: [...new Set(['en', ...inputLanguages])] }],
    expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
  }
}

/** Turns the browser's DOMExceptions into readling's error codes. */
function toAiError(error: unknown): unknown {
  if (!(error instanceof Error) || error.name === 'AbortError' || error instanceof AiError) return error
  if (error.name === 'NotAllowedError') return new AiError('builtin-activation', error.message)
  if (error.name === 'NotSupportedError') return new AiError('builtin-language', error.message)
  return new AiError('other', error.message)
}

async function promptAvailability(inputLanguages: string[], outputLanguage: string): Promise<Availability> {
  const lm = languageModel()
  if (!lm || !PROMPT_LANGUAGES.has(outputLanguage)) return 'unavailable'
  return checkAvailability(lm.availability(promptOptions(inputLanguages, outputLanguage)))
}

/** Only use Gemini Nano once it's downloaded; downloading is the person's choice. */
async function promptReady(inputLanguages: string[], outputLanguage: string): Promise<boolean> {
  return (await promptAvailability(inputLanguages, outputLanguage)) === 'available'
}

/** Runs one prompt on Gemini Nano. `outputLanguage` must be one it can write. */
export async function completeWithBuiltin(
  completion: Completion,
  inputLanguages: string[],
  outputLanguage: string,
  signal?: AbortSignal,
): Promise<string> {
  const lm = languageModel()
  if (!lm) throw new AiError('builtin-unavailable')
  const availability = await promptAvailability(inputLanguages, outputLanguage)
  if (availability === 'downloadable' || availability === 'downloading') throw new AiError('builtin-download')
  if (availability !== 'available') throw new AiError('builtin-language')
  try {
    const session = await withTimeout(
      lm.create({
        ...promptOptions(inputLanguages, outputLanguage),
        initialPrompts: [{ role: 'system', content: completion.system }],
        signal,
      }),
      TIMEOUTS.download,
      timedOut,
    )
    try {
      return await withTimeout(session.prompt(completion.user, { responseConstraint: completion.schema, signal }), TIMEOUTS.answer, timedOut)
    } finally {
      session.destroy()
    }
  } catch (error) {
    throw toAiError(error)
  }
}

const translators = new Map<string, Promise<TranslatorInstance>>()

async function translate(text: string, sourceLanguage: string, targetLanguage: string, signal?: AbortSignal): Promise<string> {
  if (!text.trim() || sourceLanguage === targetLanguage) return text
  const api = translatorApi()
  if (!api) throw new AiError('builtin-unavailable')
  const key = `${sourceLanguage}>${targetLanguage}`
  let translator = translators.get(key)
  if (!translator) {
    // Translation models are small, so they download on first use.
    translator = withTimeout(api.create({ sourceLanguage, targetLanguage }), TIMEOUTS.download, timedOut)
    translators.set(key, translator)
    // Don't keep a failed download around; the next click can try again.
    translator.catch(() => translators.delete(key))
  }
  try {
    return await withTimeout((await translator).translate(text, { signal }), TIMEOUTS.answer, timedOut)
  } catch (error) {
    throw toAiError(error)
  }
}

async function translatorAvailable(sourceLanguage: string, targetLanguage: string): Promise<boolean> {
  const api = translatorApi()
  if (!api || sourceLanguage === targetLanguage) return false
  return (await checkAvailability(api.availability({ sourceLanguage, targetLanguage }))) !== 'unavailable'
}

/** Translates a sentence on the device: with the Translator API, or Gemini Nano if it can write the target language. */
export async function translateWithBuiltin(text: string, source: string, target: string, signal?: AbortSignal): Promise<string> {
  if (await translatorAvailable(source, target)) return translate(text, source, target, signal)
  if (await promptReady([source], target)) {
    return completeWithBuiltin(sentencePrompt({ sentence: text, language: source, target }), [source], target, signal)
  }
  const english = await promptAvailability([source], 'en')
  throw new AiError(english === 'downloadable' || english === 'downloading' ? 'builtin-download' : 'builtin-unavailable')
}

export async function explainWithBuiltin(request: ExplainRequest, signal?: AbortSignal): Promise<Explanation> {
  const { language, explanationLanguage } = request

  // 1. Gemini Nano writes the explanation directly in the learner's language.
  if (await promptReady([language], explanationLanguage)) {
    const text = await completeWithBuiltin(
      { ...buildPrompt(request), schema: EXPLANATION_SCHEMA },
      [language],
      explanationLanguage,
      signal,
    )
    return parseExplanation(text)
  }

  // 2. Gemini Nano explains in English and the translator brings it into the learner's language.
  if ((await promptReady([language], 'en')) && (await translatorAvailable('en', explanationLanguage))) {
    const english = parseExplanation(
      await completeWithBuiltin(
        { ...buildPrompt({ ...request, explanationLanguage: 'en' }), schema: EXPLANATION_SCHEMA },
        [language],
        'en',
        signal,
      ),
    )
    const [translation, partOfSpeech, meaning, grammar, exampleTranslation] = await Promise.all(
      [english.translation, english.partOfSpeech, english.meaning, english.grammar, english.exampleTranslation].map(
        (field) => translate(field, 'en', explanationLanguage, signal),
      ),
    )
    return { ...english, translation, partOfSpeech, meaning, grammar, exampleTranslation }
  }

  // 3. Translation only: the word and its sentence.
  if (await translatorAvailable(language, explanationLanguage)) {
    const [translation, sentence] = await Promise.all([
      translate(request.surface, language, explanationLanguage, signal),
      translate(request.sentence, language, explanationLanguage, signal),
    ])
    return {
      lemma: request.surface,
      partOfSpeech: '',
      translation,
      meaning: `“${sentence}”`,
      grammar: '',
      example: '',
      exampleTranslation: '',
    }
  }

  // Gemini Nano could help once downloaded: point the person to Settings.
  const english = await promptAvailability([language], 'en')
  throw new AiError(english === 'downloadable' || english === 'downloading' ? 'builtin-download' : 'builtin-unavailable')
}
