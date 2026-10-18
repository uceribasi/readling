import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { ui } from '../components/ui'
import { explainWord, isAiConfigured } from '../lib/ai'
import { builtinStatus, downloadPromptModel, type BuiltinStatus } from '../lib/ai/builtin'
import { PROVIDER_GROUPS, PROVIDERS, type ProviderId } from '../lib/ai/providers'
import { deleteAllData, exportBackup, importBackup, lastBackupAt } from '../lib/backup'
import { db, requestPersistentStorage } from '../lib/db'
import { canSpeak, speak, voiceScore, voicesFor } from '../lib/speech'
import { errorMessage } from '../lib/errors'
import { loadMessages, useT, useUiLanguage } from '../lib/i18n'
import { UI_LOCALES } from '../lib/locales'
import { LANGUAGES, languageName } from '../lib/languages'
import { relativeTime } from '../lib/format'
import { useNow } from '../lib/hooks'
import { activeModel, getSettings, resolveUiLanguage, updateSettings, useSettings, type UiLanguage } from '../lib/settings'

const TEST_REQUEST = {
  term: 'lighthouse',
  surface: 'lighthouse',
  sentence: 'The old lighthouse stood at the edge of the cliff.',
  language: 'en',
}

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'ok'; text: string } | { status: 'error'; text: string }

export function SettingsPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const provider = settings.provider
  const meta = PROVIDERS[provider]
  const isAgent = meta.kind === 'agent'
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [importMessage, setImportMessage] = useState('')
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usedBytes, setUsedBytes] = useState<number | null>(null)
  const [lastBackup, setLastBackup] = useState(lastBackupAt)
  const now = useNow()

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(false))
    navigator.storage?.estimate?.().then((estimate) => setUsedBytes(estimate.usage ?? null), () => {})
  }, [])

  async function backup() {
    await exportBackup()
    setLastBackup(lastBackupAt())
  }

  async function deleteEverything() {
    if (!window.confirm(t('settings.deleteAllConfirm'))) return
    await deleteAllData()
    window.location.hash = '#/'
    window.location.reload()
  }

  function setForProvider(field: 'apiKeys' | 'models' | 'baseUrls', value: string) {
    updateSettings({ [field]: { ...settings[field], [provider]: value } })
    setTest({ status: 'idle' })
  }

  async function runTest() {
    setTest({ status: 'testing' })
    try {
      const current = getSettings()
      const result = await explainWord({ ...TEST_REQUEST, explanationLanguage: current.explanationLanguage }, current, undefined, {
        skipCache: true,
      })
      setTest({ status: 'ok', text: t('settings.testOk', { word: TEST_REQUEST.surface, translation: result.translation }) })
    } catch (error) {
      setTest({ status: 'error', text: errorMessage(error, t) })
    }
  }

  async function onImport(file: File) {
    try {
      const counts = await importBackup(file)
      setImportMessage(t('settings.importDone', counts))
    } catch {
      setImportMessage(t('settings.importError'))
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className={ui.pageTitle}>{t('settings.title')}</h1>

      <Section title={t('settings.ai')}>
        <Field label={t('settings.provider')} htmlFor="provider">
          <select
            id="provider"
            value={provider}
            onChange={(event) => {
              updateSettings({ provider: event.target.value as ProviderId })
              setTest({ status: 'idle' })
            }}
            className={ui.input}
          >
            {PROVIDER_GROUPS.map((group) => (
              <optgroup key={group.label} label={t(group.label)}>
                {group.providers.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDERS[id].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {meta.kind === 'builtin' ? (
          <BuiltinInfo language={settings.lastTextLanguage} explanationLanguage={settings.explanationLanguage} />
        ) : null}

        {isAgent ? (
          <div className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700 dark:bg-stone-800/60 dark:text-stone-300">
            <p>{t('settings.agentHowTo', { agent: meta.label.replace(/ \(.*\)$/, '') })}</p>
            <code className="mt-2 block rounded bg-white px-2 py-1 font-mono text-xs dark:bg-stone-900">npm run bridge</code>
            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">{t('settings.agentPolicy')}</p>
          </div>
        ) : null}

        {meta.needsKey || provider === 'custom' ? (
          <Field
            label={isAgent ? t('settings.pairingToken') : t('settings.apiKey')}
            htmlFor="api-key"
            aside={
              meta.keyUrl ? (
                <a href={meta.keyUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {t('settings.getKey')} ↗
                </a>
              ) : null
            }
          >
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={isAgent ? settings.bridgeToken : (settings.apiKeys[provider] ?? '')}
              onChange={(event) => {
                if (isAgent) updateSettings({ bridgeToken: event.target.value })
                else setForProvider('apiKeys', event.target.value)
                setTest({ status: 'idle' })
              }}
              className={`${ui.input} font-mono`}
            />
            {isAgent ? null : <p className={`${ui.muted} mt-1.5`}>{t('settings.keyNote', { provider: meta.label })}</p>}
          </Field>
        ) : null}

        {provider === 'anthropic' ? (
          <Field label={t('settings.workspaceId')} htmlFor="workspace-id">
            <input
              id="workspace-id"
              spellCheck={false}
              autoComplete="off"
              value={settings.anthropicWorkspaceId}
              placeholder="wrkspc_…"
              onChange={(event) => {
                updateSettings({ anthropicWorkspaceId: event.target.value })
                setTest({ status: 'idle' })
              }}
              className={`${ui.input} font-mono`}
            />
            <p className={`${ui.muted} mt-1.5`}>{t('settings.workspaceNote')}</p>
          </Field>
        ) : null}

        {meta.kind === 'builtin' ? null : (
        <Field label={t('settings.model')} htmlFor="model">
          <input
            id="model"
            list="model-suggestions"
            spellCheck={false}
            value={settings.models[provider] ?? meta.defaultModel ?? ''}
            placeholder={isAgent ? t('settings.cliDefault') : meta.modelPlaceholder}
            onChange={(event) => setForProvider('models', event.target.value)}
            className={`${ui.input} font-mono`}
          />
          <datalist id="model-suggestions">
            {meta.models?.map((model) => <option key={model} value={model} />)}
          </datalist>
          {provider === 'anthropic' && !activeModel(settings).includes('haiku') ? (
            <p className={`${ui.muted} mt-1.5`}>{t('settings.modelCostNote')}</p>
          ) : null}
        </Field>
        )}

        {meta.editableBaseUrl ? (
          <Field label={isAgent ? t('settings.bridgeUrl') : t('settings.baseUrl')} htmlFor="base-url">
            <input
              id="base-url"
              spellCheck={false}
              value={isAgent ? settings.bridgeUrl : (settings.baseUrls[provider] ?? meta.defaultBaseUrl ?? '')}
              placeholder={meta.defaultBaseUrl ?? 'https://…/v1'}
              onChange={(event) => {
                if (isAgent) updateSettings({ bridgeUrl: event.target.value })
                else setForProvider('baseUrls', event.target.value)
                setTest({ status: 'idle' })
              }}
              className={`${ui.input} font-mono`}
            />
            {provider === 'ollama' ? (
              <p className={`${ui.muted} mt-1.5`}>
                {t('settings.ollamaNote')}
                <code className="mt-1 block rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  OLLAMA_ORIGINS={window.location.origin} ollama serve
                </code>
              </p>
            ) : null}
          </Field>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={test.status === 'testing' || !isAiConfigured(settings)}
            className={ui.secondaryButton}
          >
            {test.status === 'testing' ? t('settings.testing') : t('settings.test')}
          </button>
          {test.status === 'ok' ? <p className="text-sm text-emerald-700 dark:text-emerald-400">✓ {test.text}</p> : null}
          {test.status === 'error' ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {test.text}
            </p>
          ) : null}
        </div>
      </Section>

      <Section title={t('settings.languages')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.explanationLanguage')} htmlFor="explanation-language">
            <select
              id="explanation-language"
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
          </Field>
          <Field label={t('settings.uiLanguage')} htmlFor="ui-language">
            <select
              id="ui-language"
              value={settings.uiLanguage}
              onChange={async (event) => {
                const uiLanguage = event.target.value as UiLanguage
                // Fetch the strings before switching, so the page doesn't flash in English.
                await loadMessages(resolveUiLanguage(uiLanguage))
                updateSettings({ uiLanguage })
              }}
              className={ui.input}
            >
              <option value="auto">{t('settings.auto')}</option>
              {Object.entries(UI_LOCALES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <VoiceSettings />

      <Section title={t('settings.data')}>
        <p className={ui.muted}>{t('settings.dataNote')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void backup()} className={ui.secondaryButton}>
            {t('settings.export')}
          </button>
          <label className={`${ui.secondaryButton} cursor-pointer`}>
            {t('settings.import')}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void onImport(file)
                event.target.value = ''
              }}
            />
          </label>
        </div>
        {importMessage ? <p className="text-sm text-stone-700 dark:text-stone-300">{importMessage}</p> : null}
        <p className={ui.muted}>
          {lastBackup
            ? t('settings.lastBackup', { when: relativeTime(new Date(lastBackup), now, uiLanguage) })
            : t('settings.neverBackedUp')}
          {usedBytes !== null ? ` · ${t('settings.storageUsed', { size: formatBytes(usedBytes) })}` : ''}
        </p>
        {persisted === null ? null : persisted ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">✓ {t('settings.persisted')}</p>
        ) : (
          <button
            type="button"
            onClick={() => void requestPersistentStorage().then(setPersisted)}
            className="text-left text-sm text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
          >
            {t('settings.notPersisted')}
          </button>
        )}
        <div className="border-t border-stone-200 pt-4 dark:border-stone-800">
          <button
            type="button"
            onClick={() => void deleteEverything()}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            {t('settings.deleteAll')}
          </button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${ui.card} flex flex-col gap-4 p-5`}>
      <h2 className="font-semibold text-stone-900 dark:text-stone-50">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, htmlFor, aside, children }: { label: string; htmlFor: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className={ui.label}>
          {label}
        </label>
        {aside}
      </div>
      {children}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Explains the free on-device option and shows what this browser can do right now. */
function BuiltinInfo({ language, explanationLanguage }: { language: string; explanationLanguage: string }) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const [status, setStatus] = useState<BuiltinStatus | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [download, setDownload] = useState<{ progress: number } | { error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    builtinStatus(language, explanationLanguage).then((result) => !cancelled && setStatus(result))
    return () => {
      cancelled = true
    }
  }, [language, explanationLanguage, refresh])

  const startDownload = async () => {
    setDownload({ progress: 0 })
    try {
      await downloadPromptModel((loaded) => setDownload({ progress: loaded }))
      setDownload(null)
      setRefresh((n) => n + 1)
    } catch (error) {
      setDownload({ error: errorMessage(error, t) })
    }
  }
  const needsDownload = status?.prompt === 'downloadable' || status?.prompt === 'downloading'

  const label = (availability: BuiltinStatus['prompt']) =>
    t(
      availability === 'available'
        ? 'settings.builtinReady'
        : availability === 'downloadable' || availability === 'downloading'
          ? 'settings.builtinDownload'
          : 'settings.builtinMissing',
    )

  return (
    <div className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700 dark:bg-stone-800/60 dark:text-stone-300">
      <p>{t('settings.builtinAbout')}</p>
      {status ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          <li>
            <span className="font-medium">{t('settings.builtinPrompt')}:</span>{' '}
            {needsDownload ? t('settings.builtinPromptDownload') : label(status.prompt)}
          </li>
          <li>
            <span className="font-medium">
              {t('settings.builtinTranslator', {
                from: languageName(language, uiLanguage),
                to: languageName(explanationLanguage, uiLanguage),
              })}
              :
            </span>{' '}
            {language === explanationLanguage ? t('settings.builtinSameLanguage') : label(status.translator)}
          </li>
        </ul>
      ) : (
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">{t('settings.builtinChecking')}</p>
      )}
      {needsDownload ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {download && 'progress' in download ? (
            <span className="text-xs font-medium" role="status">
              {t('settings.builtinDownloading', { percent: Math.round(download.progress * 100) })}
            </span>
          ) : (
            <button type="button" onClick={startDownload} className={ui.secondaryButton}>
              {t('settings.builtinDownloadButton')}
            </button>
          )}
          <span className="text-xs text-stone-500 dark:text-stone-400">{t('settings.builtinDownloadSize')}</span>
          {download && 'error' in download ? (
            <p className="w-full text-xs text-red-700 dark:text-red-400" role="alert">
              {download.error}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">{t('settings.builtinNote')}</p>
    </div>
  )
}

/** A read-aloud voice for each language the person reads, from the voices on this device. */
function VoiceSettings() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const textLanguages = useLiveQuery(() => db.texts.orderBy('language').uniqueKeys())
  // The voice list arrives after the page loads, and changes when voices are installed.
  const [, setVoicesLoaded] = useState(0)
  useEffect(() => {
    if (!canSpeak()) return
    const onChange = () => setVoicesLoaded((count) => count + 1)
    window.speechSynthesis.addEventListener('voiceschanged', onChange)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', onChange)
  }, [])

  const languages = [...new Set([settings.lastTextLanguage, ...((textLanguages ?? []) as string[])])].filter(
    (code) => voicesFor(code).length > 0,
  )
  if (!canSpeak() || languages.length === 0) return null

  return (
    <Section title={t('settings.voices')}>
      <p className={ui.muted}>{t('settings.voicesNote')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {languages.map((code) => {
          const voices = voicesFor(code)
          const chosen = settings.voices[code] ?? ''
          return (
            <Field key={code} label={languageName(code, uiLanguage)} htmlFor={`voice-${code}`}>
              <div className="flex gap-2">
                <select
                  id={`voice-${code}`}
                  value={chosen}
                  onChange={(event) => updateSettings({ voices: { ...settings.voices, [code]: event.target.value || undefined } })}
                  className={ui.input}
                >
                  <option value="">{t('settings.voiceAuto', { voice: voices[0].name })}</option>
                  {/* Sound-effect voices (whispering, singing…) are left out. */}
                  {voices
                    .filter((voice) => voiceScore(voice) >= 0 || voice.name === chosen)
                    .map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name}
                      </option>
                    ))}
                </select>
                <button type="button" onClick={() => speak(languageName(code, code), code)} className={ui.secondaryButton}>
                  {t('settings.voicePreview')}
                </button>
              </div>
            </Field>
          )
        })}
      </div>
    </Section>
  )
}
