import { useState, type ReactNode } from 'react'
import { isAiConfigured } from '../lib/ai'
import { builtinSupported } from '../lib/ai/builtin'
import type { ProviderId } from '../lib/ai/providers'
import type { TextDoc } from '../lib/db'
import { useT, useUiLanguage } from '../lib/i18n'
import { LANGUAGES, languageName } from '../lib/languages'
import { navigate } from '../lib/router'
import { updateSettings, useSettings } from '../lib/settings'
import { ui } from './ui'

const DISMISSED_KEY = 'readling.onboarded'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/** First-run guide on the library page: languages, an AI provider, then a sample text. */
export function Onboarding({ texts, hasWords }: { texts: TextDoc[]; hasWords: boolean }) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const [dismissed, setDismissed] = useState(readDismissed)
  const configured = isAiConfigured(settings)

  if (configured && hasWords) return null
  // After the guide is closed, keep a slim reminder until an AI provider is set up.
  if (dismissed) {
    return configured ? null : (
      <a
        href="#/settings"
        className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
      >
        {t('library.setupKey')} →
      </a>
    )
  }

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Not persisted; it simply shows again next time.
    }
  }

  function chooseProvider(provider: ProviderId) {
    updateSettings({ provider })
    navigate('/settings')
  }

  const sample = texts.find((text) => text.language === settings.lastTextLanguage) ?? texts[0]

  return (
    <section className={`${ui.card} relative flex flex-col gap-5 overflow-hidden p-5 sm:p-6`} aria-labelledby="onboarding-title">
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-indigo-500/10 blur-2xl" aria-hidden="true" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="onboarding-title" className="text-lg font-semibold text-stone-900 dark:text-stone-50">
            {t('onboarding.title')}
          </h2>
          <p className={`${ui.muted} mt-1`}>{t('onboarding.subtitle')}</p>
        </div>
        <button type="button" onClick={dismiss} className={ui.ghostButton}>
          {t('onboarding.dismiss')}
        </button>
      </div>

      <ol className="grid gap-4 md:grid-cols-3">
        <Step number={1} title={t('onboarding.step1')}>
          <label className="flex flex-col gap-1 text-sm text-stone-600 dark:text-stone-400">
            {t('onboarding.learning')}
            <select
              value={settings.lastTextLanguage}
              onChange={(event) => updateSettings({ lastTextLanguage: event.target.value })}
              className={ui.input}
            >
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, uiLanguage)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-stone-600 dark:text-stone-400">
            {t('onboarding.native')}
            <select
              value={settings.explanationLanguage}
              onChange={(event) => updateSettings({ explanationLanguage: event.target.value })}
              className={ui.input}
            >
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, uiLanguage)}
                </option>
              ))}
            </select>
          </label>
        </Step>

        <Step number={2} title={t('onboarding.step2')} done={configured}>
          {configured ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">✓ {t('onboarding.aiReady')}</p>
          ) : (
            <>
              {builtinSupported() ? (
                <button type="button" onClick={() => chooseProvider('builtin')} className={`${ui.primaryButton} justify-start`}>
                  {t('onboarding.withBuiltin')}
                </button>
              ) : null}
              <button type="button" onClick={() => chooseProvider('anthropic')} className={`${ui.secondaryButton} justify-start`}>
                {t('onboarding.withKey')}
              </button>
              <button type="button" onClick={() => chooseProvider('ollama')} className={`${ui.secondaryButton} justify-start`}>
                {t('onboarding.withOllama')}
              </button>
              <p className="text-xs text-stone-500 dark:text-stone-400">{t('onboarding.aiNote')}</p>
            </>
          )}
        </Step>

        <Step number={3} title={t('onboarding.step3')}>
          <p className="text-sm text-stone-600 dark:text-stone-400">{t('onboarding.readHint')}</p>
          {sample ? (
            <a href={`#/read/${sample.id}`} className={`${ui.primaryButton} justify-start`}>
              {t('onboarding.openSample', { title: sample.title })}
            </a>
          ) : null}
          <a href="#/new" className={`${ui.secondaryButton} justify-start`}>
            {t('onboarding.addOwn')}
          </a>
        </Step>
      </ol>
    </section>
  )
}

function Step({ number, title, done, children }: { number: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
      <p className="flex items-center gap-2 font-medium text-stone-900 dark:text-stone-100">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'
          }`}
        >
          {done ? '✓' : number}
        </span>
        {title}
      </p>
      {children}
    </li>
  )
}
