import Anthropic from '@anthropic-ai/sdk'
import { AiError, type Completion } from './types'

/** Models that accept `output_config.effort`. Unknown models get the API default. */
const SUPPORTS_EFFORT = new Set([
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-5-5',
])

/** Models that support server-side refusal fallbacks with `fallbacks: "default"`. */
const SUPPORTS_DEFAULT_FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

export async function completeWithAnthropic(
  completion: Completion,
  config: { apiKey: string; model: string; workspaceId?: string },
  signal?: AbortSignal,
): Promise<string> {
  // The key belongs to the user and never leaves their browser except to call Anthropic directly.
  const client = new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    // Organization-level keys must say which workspace to bill.
    ...(config.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': config.workspaceId } } : {}),
  })

  try {
    const response = await client.beta.messages.create(
      {
        model: config.model,
        max_tokens: 16000,
        system: completion.system,
        messages: [{ role: 'user', content: completion.user }],
        output_config: {
          ...(completion.effort && SUPPORTS_EFFORT.has(config.model) ? { effort: completion.effort } : {}),
          ...(completion.schema ? { format: { type: 'json_schema' as const, schema: completion.schema } } : {}),
        },
        ...(SUPPORTS_DEFAULT_FALLBACK.has(config.model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      },
      { signal },
    )

    if (response.stop_reason === 'refusal') throw new AiError('refusal')
    return response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
  } catch (error) {
    if (error instanceof AiError || error instanceof Anthropic.APIUserAbortError) throw error
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
      throw new AiError('auth', error.message)
    if (error instanceof Anthropic.RateLimitError) throw new AiError('rate-limit', error.message)
    if (error instanceof Anthropic.NotFoundError) throw new AiError('model', error.message)
    if (error instanceof Anthropic.BadRequestError && error.message.includes('anthropic-workspace-id'))
      throw new AiError('workspace', error.message)
    if (error instanceof Anthropic.APIConnectionError) throw new AiError('network', error.message)
    if (error instanceof Anthropic.APIError) throw new AiError('other', error.message)
    throw error
  }
}
