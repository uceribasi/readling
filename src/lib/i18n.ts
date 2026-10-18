import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { en } from '../locales/en'
import type { UiLocale } from './locales'
import { resolveUiLanguage, useSettings } from './settings'

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>

// English ships with the app; other languages load when they're used.
const loaders: Record<Exclude<UiLocale, 'en'>, () => Promise<Messages>> = {
  tr: () => import('../locales/tr').then((module) => module.tr),
  es: () => import('../locales/es').then((module) => module.es),
  de: () => import('../locales/de').then((module) => module.de),
  pt: () => import('../locales/pt').then((module) => module.pt),
}
const dictionaries: Partial<Record<UiLocale, Messages>> = { en }
let version = 0
const listeners = new Set<() => void>()

/** Loads a language's strings; the app waits for this at startup so it never flashes English. */
export async function loadMessages(locale: UiLocale): Promise<void> {
  if (dictionaries[locale] || locale === 'en') return
  try {
    dictionaries[locale] = await loaders[locale]()
    version++
    listeners.forEach((listener) => listener())
  } catch {
    // Offline before the first visit with this language: English stays.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

// "{n, plural, one {# day} other {# days}}": the ICU message syntax for plurals, with # standing for the number.
const PLURAL = /\{(\w+), plural,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/g

/** Fills `{name}` placeholders and picks plural forms with the language's plural rules. */
export function formatMessage(template: string, vars: Record<string, string | number>, language: string): string {
  return template
    .replace(PLURAL, (match, name: string, options: string) => {
      const value = vars[name]
      if (value === undefined) return match
      // Numbers may arrive already formatted ("1,678"), so read the digits.
      const count = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, ''))
      const forms = Object.fromEntries([...options.matchAll(/(\w+)\s*\{([^{}]*)\}/g)].map(([, form, text]) => [form, text]))
      const form = forms[new Intl.PluralRules(language).select(count)] ?? forms.other ?? ''
      return form.replaceAll('#', String(value))
    })
    .replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match))
}

export function useUiLanguage(): UiLocale {
  return resolveUiLanguage(useSettings().uiLanguage)
}

export function useT(): Translate {
  const language = useUiLanguage()
  const loaded = useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    void loadMessages(language)
  }, [language])
  return useCallback(
    (key, vars) => {
      const template = dictionaries[language]?.[key] ?? en[key]
      return vars ? formatMessage(template, vars, language) : template
    },
    // `loaded` changes when a dictionary arrives, so components re-render with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, loaded],
  )
}
