import type { ProviderId } from './providers'
import { AiError, type Completion } from './types'

/** Calls any OpenAI-compatible Chat Completions endpoint (OpenRouter, OpenAI, Gemini, Ollama, ...). */
export async function completeWithOpenAICompatible(
  completion: Completion,
  config: { provider: ProviderId; baseUrl: string; apiKey: string; model: string },
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin
    headers['X-Title'] = 'readling'
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: completion.system },
          { role: 'user', content: completion.user },
        ],
      }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new AiError('network', error instanceof Error ? error.message : undefined)
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    if (response.status === 401 || response.status === 403) throw new AiError('auth', detail)
    if (response.status === 429) throw new AiError('rate-limit', detail)
    if (response.status === 404) throw new AiError('model', detail)
    throw new AiError('other', `HTTP ${response.status} ${detail}`.trim())
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[]
  } | null
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new AiError('bad-response')
  return content
}
