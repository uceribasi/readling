import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { READING_LANGUAGES } from '../lib/readings'
import { updateSettings, useSettings } from '../lib/settings'
import type { ReadingsState } from '../lib/useReadings'
import { STATUS_CLASS } from './statusStyles'
import { ui } from './ui'

export function StatusLegend({ stats }: { stats?: { new: number; learning: number; known: number } }) {
  const t = useT()
  const items = [
    { swatch: STATUS_CLASS.new, label: t('reader.legendNew'), count: stats?.new },
    { swatch: STATUS_CLASS.learning, label: t('reader.legendLearning'), count: stats?.learning },
    { swatch: 'border border-stone-300 dark:border-stone-600', label: t('reader.legendKnown'), count: stats?.known },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-stone-600 dark:text-stone-400">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={`size-3 rounded-sm ${item.swatch}`} /> {item.label}
          {item.count === undefined ? null : <strong className="tabular-nums">{item.count}</strong>}
        </span>
      ))}
    </div>
  )
}

/** Side panel on desktop, bottom sheet on phones. */
export function WordAside({ open, children }: { open: boolean; children?: ReactNode }) {
  const t = useT()
  return (
    <aside className={open ? '' : 'hidden lg:block'}>
      <div aria-live="polite" className="fixed inset-x-0 bottom-0 z-30 max-h-[60dvh] overflow-y-auto rounded-t-2xl border-t border-stone-200 bg-white p-5 shadow-2xl lg:sticky lg:inset-auto lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:rounded-xl lg:border lg:shadow-none dark:border-stone-800 dark:bg-stone-900">
        {open ? children : <p className={ui.muted}>{t('reader.empty')}</p>}
      </div>
    </aside>
  )
}

/** Turns furigana (Japanese) or pinyin (Chinese) on and off, with the dictionary download's progress. */
export function ReadingsToggle({ language, state }: { language: string; state: ReadingsState }) {
  const t = useT()
  const on = useSettings().showReadings
  if (!READING_LANGUAGES.has(language)) return null
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => updateSettings({ showReadings: !on })}
        aria-pressed={on}
        title={language === 'ja' ? t('reader.readingsJaNote') : undefined}
        className={`${ui.ghostButton} ${on ? 'bg-stone-200/70 text-stone-900 dark:bg-stone-800 dark:text-stone-50' : ''}`}
      >
        {t(language === 'ja' ? 'reader.readingsJa' : 'reader.readingsZh')}
      </button>
      {state.status === 'loading' && language === 'ja' ? (
        <span className="text-xs text-stone-500 tabular-nums" role="status">
          {t('reader.readingsLoading', { percent: Math.round(state.progress * 100) })}
        </span>
      ) : null}
      {state.status === 'error' ? (
        <span className="text-xs text-red-700 dark:text-red-400" role="alert">
          {t('reader.readingsError')}
        </span>
      ) : null}
    </span>
  )
}
