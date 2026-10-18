import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { ui } from '../components/ui'
import { db, dayKey } from '../lib/db'
import { downloadFile } from '../lib/format'
import { useNow, useStreak } from '../lib/hooks'
import { useT, useUiLanguage, type MessageKey } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { updateSettings, useSettings } from '../lib/settings'
import { renderShareCard, SHARE_CARD_SIZE } from '../lib/shareCard'
import { estimateLevel, lastDays } from '../lib/stats'

const CHART_DAYS = 30

export function StatsPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const now = useNow()
  const words = useLiveQuery(() => db.words.toArray())
  const activity = useLiveQuery(() => db.activity.toArray())

  // Languages with words, most words first.
  const languages = useMemo(() => {
    const counts = new Map<string, number>()
    for (const word of words ?? []) counts.set(word.language, (counts.get(word.language) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code)
  }, [words])
  const [picked, setPicked] = useState<string | null>(null)
  const language =
    picked && languages.includes(picked) ? picked : languages.includes(settings.lastTextLanguage) ? settings.lastTextLanguage : languages[0]

  const days = useMemo(() => lastDays(CHART_DAYS, new Date(now)), [now])

  const summary = useMemo(() => {
    const perDay = new Map(days.map((day) => [day, { known: 0, learning: 0 }]))
    let known = 0
    let learning = 0
    for (const word of words ?? []) {
      if (word.language !== language) continue
      const created = dayKey(word.createdAt)
      if (word.status === 'known') known++
      if (word.status === 'learning') learning++
      const bucket = perDay.get(created)
      if (bucket && word.status !== 'ignored') bucket[word.status === 'learning' ? 'learning' : 'known']++
    }
    let wordsRead = 0
    let reviews = 0
    for (const day of activity ?? []) {
      wordsRead += day.wordsRead
      reviews += day.reviews
    }
    return { known, learning, wordsRead, reviews, perDay: days.map((day) => ({ day, ...perDay.get(day)! })) }
  }, [words, activity, language, days])

  const streak = useStreak() ?? { current: 0, best: 0, activeToday: false }
  const level = language ? estimateLevel(summary.known, language) : null
  const format = (n: number) => n.toLocaleString(uiLanguage)

  if (words && words.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className={ui.pageTitle}>{t('stats.title')}</h1>
        <p className={ui.muted}>{t('stats.empty')}</p>
        <a href="#/" className={ui.secondaryButton}>
          {t('nav.library')}
        </a>
      </div>
    )
  }
  if (!words || !activity || !language || !level) return null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className={ui.pageTitle}>{t('stats.title')}</h1>
        {languages.length > 1 ? (
          <div>
            <label htmlFor="stats-language" className="sr-only">
              {t('stats.language')}
            </label>
            <select id="stats-language" value={language} onChange={(event) => setPicked(event.target.value)} className={ui.input}>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, uiLanguage)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          value={format(streak.current)}
          label={t('stats.streakDays', { n: streak.current })}
          detail={`${streak.activeToday ? t('stats.doneToday') : t('stats.keepGoing')} ${t('stats.bestStreak', { n: streak.best })}`}
          accent
        />
        <StatCard value={format(summary.known)} label={t('stats.known')} detail={languageName(language, uiLanguage)} />
        <StatCard value={format(summary.learning)} label={t('stats.learning')} detail={t('stats.reviewsDone', { n: format(summary.reviews) })} />
        <StatCard value={format(summary.wordsRead)} label={t('stats.wordsRead')} detail={t('stats.allLanguages')} />
      </div>

      <section className={`${ui.card} flex flex-col gap-3 p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-stone-600 dark:text-stone-400">{t('stats.level')}</h2>
          {settings.readingLevel === level.level ? (
            <span className="text-xs text-stone-500 dark:text-stone-400">{t('stats.levelInUse')}</span>
          ) : (
            <button type="button" onClick={() => updateSettings({ readingLevel: level.level })} className={ui.ghostButton}>
              {t('stats.useLevel')}
            </button>
          )}
        </div>
        <p className="flex items-baseline gap-3">
          <span className="text-4xl font-semibold text-stone-900 dark:text-stone-50">{level.level}</span>
          <span className={ui.muted}>{t(`levelName.${level.level}` as MessageKey)}</span>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" aria-hidden="true">
          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.round(level.progress * 100)}%` }} />
        </div>
        <p className="text-sm text-stone-700 dark:text-stone-300">
          {level.next && level.nextAt !== undefined
            ? t('stats.levelNext', { n: format(level.nextAt - summary.known), level: level.next })
            : t('stats.levelTop')}
        </p>
        <p className="text-xs text-stone-500 dark:text-stone-400">{t('stats.levelNote')}</p>
      </section>

      <section className={`${ui.card} flex flex-col gap-4 p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-stone-600 dark:text-stone-400">{t('stats.chartTitle')}</h2>
          <span className="flex gap-3 text-xs text-stone-500 dark:text-stone-400">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-emerald-500" aria-hidden="true" /> {t('stats.known')}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-amber-400" aria-hidden="true" /> {t('stats.learning')}
            </span>
          </span>
        </div>
        <DailyChart days={summary.perDay} />
      </section>

      <ShareSection
        heading={t('card.heading', { language: languageName(language, uiLanguage) })}
        stats={[
          { value: format(streak.current), label: t('card.streak', { n: streak.current }) },
          { value: format(summary.known), label: t('card.known') },
          { value: level.level, label: t('card.level') },
          { value: format(summary.wordsRead), label: t('card.read') },
        ]}
        days={summary.perDay.map((day) => day.known + day.learning)}
      />
    </div>
  )
}

function StatCard({ value, label, detail, accent = false }: { value: string; label: string; detail: string; accent?: boolean }) {
  return (
    <div className={`${ui.card} flex flex-col gap-1 p-4 ${accent ? 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-500/30 dark:bg-indigo-500/10' : ''}`}>
      <span className="text-3xl font-semibold text-stone-900 tabular-nums dark:text-stone-50">
        {accent ? <span aria-hidden="true">🔥 </span> : null}
        {value}
      </span>
      <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>
      <span className="text-xs text-stone-500 dark:text-stone-400">{detail}</span>
    </div>
  )
}

/** New words per day, stacked by their current status. */
function DailyChart({ days }: { days: { day: string; known: number; learning: number }[] }) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(uiLanguage, { day: 'numeric', month: 'short' }), [uiLanguage])
  const label = (day: string) => {
    const [year, month, date] = day.split('-').map(Number)
    return dateFormat.format(new Date(year, month - 1, date))
  }
  const max = Math.max(1, ...days.map((day) => day.known + day.learning))
  const width = 600
  const height = 140
  const gap = 4
  const barWidth = (width - gap * (days.length - 1)) / days.length

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label={t('stats.chartTitle')}>
        {days.map((day, index) => {
          const x = index * (barWidth + gap)
          const knownHeight = (day.known / max) * height
          const learningHeight = (day.learning / max) * height
          return (
            <g key={day.day}>
              <title>{t('stats.chartDay', { date: label(day.day), known: day.known, learning: day.learning })}</title>
              <rect x={x} y={0} width={barWidth} height={height} className="fill-transparent" />
              {day.known + day.learning === 0 ? (
                <rect x={x} y={height - 2} width={barWidth} height={2} rx={1} className="fill-stone-200 dark:fill-stone-800" />
              ) : null}
              <rect x={x} y={height - knownHeight} width={barWidth} height={knownHeight} rx={2} className="fill-emerald-500" />
              <rect
                x={x}
                y={height - knownHeight - learningHeight}
                width={barWidth}
                height={learningHeight}
                rx={2}
                className="fill-amber-400"
              />
            </g>
          )
        })}
      </svg>
      <figcaption className="flex justify-between text-xs text-stone-400 tabular-nums">
        <span>{label(days[0].day)}</span>
        <span>{label(days[Math.floor(days.length / 2)].day)}</span>
        <span>{label(days[days.length - 1].day)}</span>
      </figcaption>
    </figure>
  )
}

/** Previews the progress image and offers to share or download it. */
function ShareSection({ heading, stats, days }: { heading: string; stats: { value: string; label: string }[]; days: number[] }) {
  const t = useT()
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null)
  const footer = t('card.footer')
  // Primitive dependency, so the image is redrawn only when what it shows changes.
  const key = JSON.stringify({ heading, stats, days, footer })

  useEffect(() => {
    let cancelled = false
    let url = ''
    const data = JSON.parse(key) as { heading: string; stats: { value: string; label: string }[]; days: number[]; footer: string }
    renderShareCard(data)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setImage({ blob, url })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [key])

  const file = image ? new File([image.blob], 'readling-progress.png', { type: 'image/png' }) : null
  const canShare = Boolean(file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }))

  return (
    <section className={`${ui.card} flex flex-col gap-4 p-5`}>
      <h2 className="text-sm font-medium text-stone-600 dark:text-stone-400">{t('stats.share')}</h2>
      {image ? (
        <img
          src={image.url}
          alt={t('stats.shareAlt')}
          width={SHARE_CARD_SIZE.width}
          height={SHARE_CARD_SIZE.height}
          className="h-auto w-full rounded-lg shadow-sm ring-1 ring-stone-200 dark:ring-stone-800"
        />
      ) : (
        <div className="aspect-[1200/630] w-full animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
      )}
      <div className="flex flex-wrap gap-2">
        {canShare && file ? (
          <button
            type="button"
            onClick={() => void navigator.share({ files: [file], title: 'readling' }).catch(() => {})}
            className={ui.primaryButton}
          >
            {t('stats.shareButton')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!image}
          onClick={() => image && downloadFile('readling-progress.png', image.blob, 'image/png')}
          className={canShare ? ui.secondaryButton : ui.primaryButton}
        >
          {t('stats.download')}
        </button>
      </div>
    </section>
  )
}
