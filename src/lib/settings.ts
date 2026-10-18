import { useSyncExternalStore } from 'react'
import { builtinSupported } from './ai/builtin'
import { BRIDGE_URL, PROVIDERS, type ProviderId } from './ai/providers'
import { LANGUAGES } from './languages'
import type { Level } from './levels'
import { isUiLocale, type UiLocale } from './locales'

export type UiLanguage = 'auto' | UiLocale

export interface Settings {
  provider: ProviderId
  apiKeys: Partial<Record<ProviderId, string>>
  models: Partial<Record<ProviderId, string>>
  baseUrls: Partial<Record<ProviderId, string>>
  /** Needed only for Anthropic API keys that aren't scoped to a workspace. */
  anthropicWorkspaceId: string
  /** Shared by every local agent, since they all go through the same bridge. */
  bridgeToken: string
  bridgeUrl: string
  /** Language the AI writes explanations in (the learner's native language). */
  explanationLanguage: string
  uiLanguage: UiLanguage
  /** Pre-selects the language when adding a new text. */
  lastTextLanguage: string
  /** Level last picked for AI stories and rewrites. */
  readingLevel: Level
  /** Furigana over Japanese and pinyin over Chinese texts. */
  showReadings: boolean
  /** Read-aloud voice name per language; missing means the best one installed. */
  voices: Partial<Record<string, string>>
}

const STORAGE_KEY = 'readling.settings'

/** The browser's preferred languages as base codes ("pt-BR" → "pt"), most preferred first. */
function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return (navigator.languages?.length ? navigator.languages : [navigator.language]).map((tag) => tag.split('-')[0].toLowerCase())
}

const defaults: Settings = {
  // Works out of the box where the browser has on-device AI; otherwise people pick a provider.
  provider: builtinSupported() ? 'builtin' : 'anthropic',
  apiKeys: {},
  models: {},
  baseUrls: {},
  anthropicWorkspaceId: '',
  bridgeToken: '',
  bridgeUrl: BRIDGE_URL,
  // Explanations in the learner's own language when readling supports it.
  explanationLanguage: browserLanguages().find((code) => (LANGUAGES as readonly string[]).includes(code)) ?? 'en',
  uiLanguage: 'auto',
  lastTextLanguage: 'en',
  readingLevel: 'A2',
  showReadings: false,
  voices: {},
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall back to defaults.
  }
  return defaults
}

let current = load()
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Keep the in-memory value even if it can't be persisted.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings)
}

export function resolveUiLanguage(setting: UiLanguage): UiLocale {
  if (setting !== 'auto') return setting
  return browserLanguages().find(isUiLocale) ?? 'en'
}

export function activeModel(settings: Settings): string {
  const provider = settings.provider
  return (settings.models[provider] ?? PROVIDERS[provider].defaultModel ?? '').trim()
}

export function activeBaseUrl(settings: Settings): string {
  const provider = settings.provider
  if (PROVIDERS[provider].kind === 'agent') return settings.bridgeUrl.trim()
  return (settings.baseUrls[provider] ?? PROVIDERS[provider].defaultBaseUrl ?? '').trim()
}

/** The provider's API key, or the bridge pairing token for local agents. */
export function activeApiKey(settings: Settings): string {
  if (PROVIDERS[settings.provider].kind === 'agent') return settings.bridgeToken.trim()
  return (settings.apiKeys[settings.provider] ?? '').trim()
}
