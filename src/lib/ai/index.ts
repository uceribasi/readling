import { db } from '../db'
import { activeApiKey, activeBaseUrl, activeModel, type Settings } from '../settings'
import { builtinSupported, completeWithBuiltin, explainWithBuiltin, translateWithBuiltin } from './builtin'
import { PROVIDERS } from './providers'
import {
  AiError,
  buildPrompt,
  cleanPlainReply,
  EXPLANATION_SCHEMA,
  parseExplanation,
  parseJsonObject,
  sentencePrompt,
  type Completion,
  type ExplainRequest,
  type Explanation,
  type SentenceRequest,
} from './types'

function cacheKey(request: ExplainRequest): string {
  return [request.language, request.explanationLanguage, request.term, request.sentence].join('|')
}

export function isAiConfigured(settings: Settings): boolean {
  const meta = PROVIDERS[settings.provider]
  if (meta.kind === 'builtin') return builtinSupported()
  if (meta.needsKey && !activeApiKey(settings)) return false
  if (meta.kind !== 'anthropic' && !activeBaseUrl(settings)) return false
  // Local agents fall back to the CLI's own default model.
  return meta.kind === 'agent' || activeModel(settings) !== ''
}

export async function getCachedExplanation(request: ExplainRequest): Promise<Explanation | undefined> {
  return (await db.explanations.get(cacheKey(request)))?.data
}

/**
 * Sends one prompt to the configured provider and returns its text. `languages` tells the
 * on-device model which languages it will read and write.
 */
export async function complete(
  settings: Settings,
  completion: Completion,
  signal?: AbortSignal,
  languages: { input: string[]; output: string } = { input: [], output: 'en' },
): Promise<string> {
  const provider = settings.provider
  const meta = PROVIDERS[provider]
  const apiKey = activeApiKey(settings)
  const model = activeModel(settings)
  if (meta.needsKey && !apiKey) throw new AiError('no-key')
  if (!model && meta.kind !== 'agent' && meta.kind !== 'builtin') throw new AiError('no-model')

  // Provider clients are loaded on demand so the Anthropic SDK stays out of the main bundle.
  switch (meta.kind) {
    case 'builtin':
      return completeWithBuiltin(completion, languages.input, languages.output, signal)
    case 'anthropic':
      return (await import('./anthropic')).completeWithAnthropic(
        completion,
        { apiKey, model, workspaceId: settings.anthropicWorkspaceId.trim() },
        signal,
      )
    case 'agent':
      return (await import('./localAgent')).completeWithLocalAgent(
        completion,
        { agent: provider, bridgeUrl: activeBaseUrl(settings), token: apiKey, model },
        signal,
      )
    default:
      return (await import('./openaiCompatible')).completeWithOpenAICompatible(
        completion,
        { provider, baseUrl: activeBaseUrl(settings), apiKey, model },
        signal,
      )
  }
}

/** Like complete(), but the reply must be a JSON object (use `completion.schema` to describe it). */
export async function generateJson(
  settings: Settings,
  completion: Completion,
  signal?: AbortSignal,
  languages?: { input: string[]; output: string },
): Promise<Record<string, unknown>> {
  return parseJsonObject(await complete(settings, completion, signal, languages))
}

export async function explainWord(
  request: ExplainRequest,
  settings: Settings,
  signal?: AbortSignal,
  options: { skipCache?: boolean } = {},
): Promise<Explanation> {
  if (!options.skipCache) {
    const cached = await getCachedExplanation(request)
    if (cached) return cached
  }

  const data =
    PROVIDERS[settings.provider].kind === 'builtin'
      ? await explainWithBuiltin(request, signal)
      : parseExplanation(
          await complete(settings, { ...buildPrompt(request), schema: EXPLANATION_SCHEMA, effort: 'low' }, signal),
        )

  await db.explanations.put({ key: cacheKey(request), data, createdAt: Date.now() })
  return data
}

function translationKey(request: SentenceRequest): string {
  return [request.language, request.target, request.sentence].join('|')
}

export async function getCachedTranslation(request: SentenceRequest): Promise<string | undefined> {
  return (await db.translations.get(translationKey(request)))?.text
}

/** Translates a whole sentence into the learner's language. Results are cached like explanations. */
export async function translateSentence(request: SentenceRequest, settings: Settings, signal?: AbortSignal): Promise<string> {
  const cached = await getCachedTranslation(request)
  if (cached) return cached
  const text =
    PROVIDERS[settings.provider].kind === 'builtin'
      ? await translateWithBuiltin(request.sentence, request.language, request.target, signal)
      : cleanPlainReply(await complete(settings, sentencePrompt(request), signal, { input: [request.language], output: request.target }))
  if (!text) throw new AiError('bad-response')
  await db.translations.put({ key: translationKey(request), text, createdAt: Date.now() })
  return text
}

export { AiError } from './types'
export type { Explanation, ExplainRequest } from './types'
