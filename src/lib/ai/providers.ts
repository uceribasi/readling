export type ProviderId =
  | 'builtin'
  | 'anthropic'
  | 'openrouter'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'custom'

/**
 * - `anthropic`: Anthropic SDK, called from the browser.
 * - `openai-compatible`: any Chat Completions endpoint, called from the browser.
 * - `agent`: a coding-agent CLI on this computer, reached through the local readling bridge.
 * - `builtin`: the browser's own on-device AI (Chrome's Prompt and Translator APIs).
 */
export type ProviderKind = 'anthropic' | 'openai-compatible' | 'agent' | 'builtin'

export interface ProviderMeta {
  label: string
  kind: ProviderKind
  /** API key, or the bridge pairing token for local agents. */
  needsKey: boolean
  defaultBaseUrl?: string
  editableBaseUrl: boolean
  keyUrl?: string
  /** Suggested models shown in the model field. */
  models?: string[]
  defaultModel?: string
  modelPlaceholder?: string
}

export const BRIDGE_URL = 'http://127.0.0.1:8787'

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  builtin: {
    label: 'Browser AI (free, on-device)',
    kind: 'builtin',
    needsKey: false,
    editableBaseUrl: false,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    needsKey: true,
    editableBaseUrl: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    defaultModel: 'claude-opus-5-5',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    editableBaseUrl: false,
    keyUrl: 'https://openrouter.ai/keys',
    modelPlaceholder: 'provider/model-name',
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    editableBaseUrl: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    modelPlaceholder: 'model-name',
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    editableBaseUrl: false,
    keyUrl: 'https://aistudio.google.com/apikey',
    modelPlaceholder: 'gemini-model-name',
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    needsKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    editableBaseUrl: true,
    modelPlaceholder: 'llama3.2',
  },
  'claude-code': {
    label: 'Claude Code (local CLI)',
    kind: 'agent',
    needsKey: true,
    defaultBaseUrl: BRIDGE_URL,
    editableBaseUrl: true,
    models: ['haiku', 'sonnet', 'opus'],
  },
  codex: {
    label: 'Codex (local CLI)',
    kind: 'agent',
    needsKey: true,
    defaultBaseUrl: BRIDGE_URL,
    editableBaseUrl: true,
  },
  antigravity: {
    label: 'Antigravity (local CLI)',
    kind: 'agent',
    needsKey: true,
    defaultBaseUrl: BRIDGE_URL,
    editableBaseUrl: true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai-compatible',
    needsKey: false,
    editableBaseUrl: true,
    modelPlaceholder: 'model-name',
  },
}

export const PROVIDER_GROUPS: {
  label: 'settings.groupFree' | 'settings.groupApi' | 'settings.groupLocal'
  providers: ProviderId[]
}[] = [
  { label: 'settings.groupFree', providers: ['builtin', 'ollama'] },
  { label: 'settings.groupApi', providers: ['anthropic', 'openrouter', 'openai', 'gemini', 'custom'] },
  { label: 'settings.groupLocal', providers: ['claude-code', 'codex', 'antigravity'] },
]
