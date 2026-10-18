import type { ProviderId } from './providers'
import { AiError, type AiErrorCode, type Completion } from './types'

const BRIDGE_ERRORS: Record<string, AiErrorCode> = {
  'bridge-auth': 'bridge-auth',
  'agent-missing': 'agent-missing',
  'agent-failed': 'agent-failed',
  busy: 'rate-limit',
  timeout: 'timeout',
}

/** Sends a prompt to a coding-agent CLI on this computer, via the local readling bridge. */
export async function completeWithLocalAgent(
  completion: Completion,
  config: { agent: ProviderId; bridgeUrl: string; token: string; model: string },
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${config.bridgeUrl.replace(/\/+$/, '')}/v1/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({
        agent: config.agent,
        model: config.model || undefined,
        system: completion.system,
        prompt: completion.user,
      }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new AiError('bridge-offline')
  }

  const data = (await response.json().catch(() => null)) as {
    text?: unknown
    error?: { code?: string; message?: string }
  } | null

  if (!response.ok) {
    const code = BRIDGE_ERRORS[data?.error?.code ?? ''] ?? 'other'
    throw new AiError(code, data?.error?.message ?? `HTTP ${response.status}`)
  }
  if (typeof data?.text !== 'string') throw new AiError('bad-response')
  return data.text
}
