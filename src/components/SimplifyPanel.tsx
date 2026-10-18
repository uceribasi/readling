import { useEffect, useRef, useState } from 'react'
import { isAiConfigured } from '../lib/ai'
import { simplifyText } from '../lib/ai/write'
import { addText, type TextDoc } from '../lib/db'
import { errorMessage } from '../lib/errors'
import { useT } from '../lib/i18n'
import { navigate } from '../lib/router'
import { updateSettings, useSettings } from '../lib/settings'
import { LevelSelect } from './StoryGenerator'
import { ui } from './ui'

/**
 * Rewrites the page being read (or the whole text, if it's short) at an easier level and
 * opens the result as a new text. The original stays untouched.
 */
export function SimplifyPanel({
  text,
  pageText,
  multiPage,
  onClose,
}: {
  text: TextDoc
  pageText: string
  multiPage: boolean
  onClose: () => void
}) {
  const t = useT()
  const settings = useSettings()
  const [state, setState] = useState<{ status: 'idle' | 'working' } | { status: 'error'; message: string }>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function rewrite() {
    controller.current?.abort()
    controller.current = new AbortController()
    const signal = controller.current.signal
    setState({ status: 'working' })
    try {
      const level = settings.readingLevel
      const result = await simplifyText(settings, { language: text.language, level, title: text.title, text: pageText }, signal)
      if (signal.aborted) return
      const id = await addText({
        title: `${result.title || text.title} (${level})`,
        language: text.language,
        content: result.text,
        sourceUrl: text.sourceUrl,
      })
      navigate(`/read/${id}`)
    } catch (error) {
      if (!signal.aborted) setState({ status: 'error', message: errorMessage(error, t) })
    }
  }

  return (
    <div className={`${ui.card} mt-4 flex flex-col gap-3 p-4`}>
      <p className="text-sm font-medium text-stone-900 dark:text-stone-50">
        {t(multiPage ? 'simplify.titlePage' : 'simplify.titleText')}
      </p>
      {isAiConfigured(settings) ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="simplify-level" className="sr-only">
              {t('story.level')}
            </label>
            <div className="w-56">
              <LevelSelect id="simplify-level" value={settings.readingLevel} onChange={(readingLevel) => updateSettings({ readingLevel })} />
            </div>
            <button type="button" onClick={rewrite} disabled={state.status === 'working'} className={ui.primaryButton}>
              {state.status === 'working' ? t('simplify.working') : t('simplify.go')}
            </button>
            <button type="button" onClick={onClose} className={ui.ghostButton}>
              {t('new.cancel')}
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">{t('simplify.note')}</p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-stone-700 dark:text-stone-300">{t('story.needsAi')}</p>
          <a href="#/settings" className={ui.secondaryButton}>
            {t('story.openSettings')}
          </a>
        </div>
      )}
      {state.status === 'error' ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
