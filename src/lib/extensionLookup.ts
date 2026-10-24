import type { ExplainRequest, Explanation } from './ai/types'
import { supportedLanguage } from './languages'
import { MAX_PHRASE_WORDS, phraseTerm } from './phrases'
import { tokenize } from './tokenize'

export interface ExtensionLookupRequest {
  version: 1
  action: 'explain'
  id: string
  createdAt: number
  surface: string
  sentence: string
  url: string
  title: string
  language?: string
}

export type ExtensionLookupResponse = {
  version: 1
  id: string
  ok: true
  surface: string
  language: string
  translation: string
  meaning: string
  grammar: string
  example: string
  exampleTranslation: string
  saved: boolean
} | { version: 1; id: string; ok: false; error: 'invalid' | 'busy' | 'expired' | 'failed' | 'timeout' }

const ID = /^[a-zA-Z0-9_-]{24,80}$/
const TTL = 5 * 60_000

/** The bridge accepts plain bounded data, never messages carrying URLs to fetch or settings to apply. */
export function parseExtensionLookup(value: unknown, now = Date.now()): ExtensionLookupRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (data.version !== 1 || data.action !== 'explain' || typeof data.id !== 'string' || !ID.test(data.id)) return null
  if (typeof data.createdAt !== 'number' || !Number.isFinite(data.createdAt) || now - data.createdAt > TTL || data.createdAt - now > 10_000) return null
  if (typeof data.surface !== 'string' || !data.surface.trim() || data.surface.length > 160 || !/\p{L}/u.test(data.surface)) return null
  if (typeof data.sentence !== 'string' || !data.sentence.trim() || data.sentence.length > 2_000) return null
  if (typeof data.url !== 'string' || data.url.length > 2_048) return null
  if (typeof data.title !== 'string' || data.title.length > 300) return null
  if (data.language !== undefined && (typeof data.language !== 'string' || data.language.length > 40)) return null
  try {
    const url = new URL(data.url)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
  } catch { return null }
  return { version: 1, action: 'explain', id: data.id, createdAt: data.createdAt, surface: data.surface.trim(), sentence: data.sentence.trim(), url: data.url, title: data.title, language: supportedLanguage(data.language as string | undefined) }
}

interface LookupDependencies {
  settings: () => { explanationLanguage: string; lastTextLanguage: string }
  explain: (request: ExplainRequest, signal: AbortSignal) => Promise<Explanation>
  save: (request: ExtensionLookupRequest & { language: string; term: string }, explanation: Explanation) => Promise<void>
  now?: () => number
}

/** Only the extension's explicit scripting call invokes this function. There is no message/event receiver. */
export function createExtensionLookupHandler(dependencies: LookupDependencies) {
  const now = dependencies.now ?? Date.now
  const results = new Map<string, { fingerprint: string; request: ExtensionLookupRequest & { language: string; term: string }; explanation: Explanation; response: Extract<ExtensionLookupResponse, { ok: true }>; saving?: Promise<void> }>()
  let controller: AbortController | undefined
  let disposed = false
  const fail = (id: string, error: Extract<ExtensionLookupResponse, { ok: false }>['error']): ExtensionLookupResponse => ({ version: 1, id, ok: false, error })

  async function handle(value: unknown): Promise<ExtensionLookupResponse> {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    const id = typeof data.id === 'string' && ID.test(data.id) ? data.id : ''
    if (disposed) return fail(id, 'expired')
    for (const [key, entry] of results) if (now() - entry.request.createdAt > TTL) results.delete(key)
    if (data.version === 1 && data.action === 'save' && id) {
      const result = results.get(id)
      if (!result) return fail(id, 'expired')
      try {
        if (!result.response.saved) {
          result.saving ??= dependencies.save(result.request, result.explanation)
          await result.saving
          result.response.saved = true
        }
        return { ...result.response }
      } catch { result.saving = undefined; return fail(id, 'failed') }
    }
    const request = parseExtensionLookup(value, now())
    if (!request) return fail(id, 'invalid')
    const existing = results.get(id)
    if (existing) {
      if (JSON.stringify(request) !== existing.fingerprint) return fail(id, 'invalid')
      return { ...existing.response }
    }
    if (controller) return fail(id, 'busy')
    controller = new AbortController()
    const currentController = controller
    const timer = setTimeout(() => currentController.abort(), 45_000)
    try {
      const settings = dependencies.settings()
      const language = request.language ?? supportedLanguage(settings.lastTextLanguage) ?? 'en'
      const terms = tokenize(request.surface, language).flatMap((paragraph) => paragraph.sentences.flatMap((sentence) => sentence.tokens.flatMap((token) => token.kind === 'word' ? [token.term] : [])))
      if (!terms.length || terms.length > MAX_PHRASE_WORDS) return fail(id, 'invalid')
      const term = phraseTerm(terms)
      const aborted = new Promise<never>((_resolve, reject) => currentController.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
      const explanation = await Promise.race([
        dependencies.explain({ term, surface: request.surface, sentence: request.sentence, language, explanationLanguage: settings.explanationLanguage }, currentController.signal),
        aborted,
      ])
      if (currentController.signal.aborted || disposed) return fail(id, 'timeout')
      // Only educational fields leave the app. In particular no provider config or raw error text does.
      const response: Extract<ExtensionLookupResponse, { ok: true }> = {
        version: 1, id, ok: true, surface: request.surface, language, saved: false,
        translation: explanation.translation.slice(0, 500), meaning: explanation.meaning.slice(0, 1_500), grammar: explanation.grammar.slice(0, 800),
        example: explanation.example.slice(0, 1_000), exampleTranslation: explanation.exampleTranslation.slice(0, 1_000),
      }
      if (results.size >= 32) results.delete(results.keys().next().value!)
      results.set(id, { fingerprint: JSON.stringify(request), request: { ...request, language, term }, explanation, response })
      return { ...response }
    } catch { return fail(id, currentController.signal.aborted ? 'timeout' : 'failed') }
    finally { clearTimeout(timer); if (controller === currentController) controller = undefined }
  }
  return { handle, dispose: () => { disposed = true; controller?.abort(); results.clear() } }
}
