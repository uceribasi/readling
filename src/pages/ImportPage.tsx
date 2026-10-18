import { useMemo, useState, useSyncExternalStore } from 'react'
import { TextInfo } from '../components/Difficulty'
import { ui } from '../components/ui'
import { addText, requestPersistentStorage } from '../lib/db'
import { useT, useUiLanguage } from '../lib/i18n'
import { LANGUAGES, languageName, supportedLanguage } from '../lib/languages'
import { navigate } from '../lib/router'
import { updateSettings, useSettings } from '../lib/settings'

interface PendingImport {
  title: string
  text: string
  url?: string
  lang?: string
}

type ImportWindow = Window & { __readlingImport?: unknown }

function subscribe(onChange: () => void) {
  window.addEventListener('readling:import', onChange)
  return () => window.removeEventListener('readling:import', onChange)
}

function delivered(): unknown {
  return (window as ImportWindow).__readlingImport
}

/** The page the browser extension left in this tab, checked before it's trusted. */
function parsePending(data: unknown): PendingImport | null {
  if (!data || typeof data !== 'object') return null
  const { title, text, url, lang } = data as Record<string, unknown>
  if (typeof text !== 'string' || !text.trim()) return null
  return {
    title: typeof title === 'string' ? title.trim().slice(0, 300) : '',
    text: text.trim().slice(0, 500_000),
    url: typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined,
    lang: typeof lang === 'string' ? lang : undefined,
  }
}

function clearPending() {
  delete (window as ImportWindow).__readlingImport
}

/** Receives a web page from the readling browser extension ("Read this page in readling"). */
export function ImportPage() {
  const t = useT()
  // The extension may deliver the page before or after this screen appears.
  const data = useSyncExternalStore(subscribe, delivered)
  const pending = useMemo(() => parsePending(data), [data])

  if (!pending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4">
        <h1 className={ui.pageTitle}>{t('import.title')}</h1>
        <p className="text-stone-700 dark:text-stone-300">{t('import.empty')}</p>
        <p className={ui.muted}>{t('import.howTo')}</p>
        <a href="#/new" className={ui.secondaryButton}>
          {t('import.paste')}
        </a>
      </div>
    )
  }

  return <ImportForm key={`${pending.url}:${pending.text.length}`} pending={pending} />
}

function ImportForm({ pending }: { pending: PendingImport }) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const [title, setTitle] = useState(pending.title)
  const [language, setLanguage] = useState(() => supportedLanguage(pending.lang) ?? settings.lastTextLanguage)
  const [saving, setSaving] = useState(false)

  const shownTitle = title
  const shownLanguage = language
  let host = ''
  try {
    host = pending.url ? new URL(pending.url).hostname.replace(/^www\./, '') : ''
  } catch {
    // No source to show.
  }

  async function save() {
    setSaving(true)
    const id = await addText({
      title: shownTitle.trim() || host || t('new.untitled'),
      language: shownLanguage,
      content: pending.text,
      sourceUrl: pending.url,
    })
    clearPending()
    updateSettings({ lastTextLanguage: shownLanguage })
    void requestPersistentStorage()
    navigate(`/read/${id}`)
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className={ui.pageTitle}>{t('import.title')}</h1>

      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor="import-title" className={ui.label}>
            {t('new.titleLabel')}
          </label>
          <input id="import-title" dir="auto" value={shownTitle} onChange={(event) => setTitle(event.target.value)} className={ui.input} />
        </div>
        <div>
          <label htmlFor="import-language" className={ui.label}>
            {t('new.languageLabel')}
          </label>
          <select id="import-language" value={shownLanguage} onChange={(event) => setLanguage(event.target.value)} className={ui.input}>
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {languageName(code, uiLanguage)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`${ui.card} flex flex-col gap-2 p-4`}>
        {host && pending.url ? (
          <a href={pending.url} target="_blank" rel="noreferrer" className="w-fit text-sm text-stone-500 underline-offset-2 hover:underline dark:text-stone-400">
            {t('reader.source', { host })}
          </a>
        ) : null}
        <p lang={shownLanguage} dir="auto" className="font-reading line-clamp-6 text-base leading-relaxed whitespace-pre-line text-stone-700 dark:text-stone-300">
          {pending.text.slice(0, 1200)}
        </p>
      </div>
      <TextInfo text={pending.text} language={shownLanguage} />

      <div className="flex justify-end gap-2">
        <a href="#/" className={ui.secondaryButton}>
          {t('new.cancel')}
        </a>
        <button type="button" onClick={save} disabled={saving} className={ui.primaryButton}>
          {t('new.save')}
        </button>
      </div>
    </div>
  )
}
