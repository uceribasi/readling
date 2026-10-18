import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { BackupReminder } from '../components/BackupReminder'
import { DifficultyBadge } from '../components/Difficulty'
import { Onboarding } from '../components/Onboarding'
import { ui } from '../components/ui'
import { db, deleteText, type TextDoc, type WordEntry } from '../lib/db'
import { measureTerms, MIN_KNOWN_FOR_DIFFICULTY } from '../lib/difficulty'
import { useStreak } from '../lib/hooks'
import { useT, useUiLanguage } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { countWords, tokenize, uniqueTerms } from '../lib/tokenize'

export function LibraryPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  // Most recently read first, then most recently added.
  const texts = useLiveQuery(async () =>
    (await db.texts.toArray()).sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)),
  )
  // Segment texts only when the library changes; word status changes just recount these terms.
  const textTerms = useMemo(
    () => new Map((texts ?? []).filter((text) => text.kind !== 'pdf').map((text) => [text.id, uniqueTerms(tokenize(text.content, text.language))])),
    [texts],
  )
  const vocabulary = useLiveQuery(() => db.words.toArray())
  const libraryTexts = useMemo(() => {
    const byLanguage = new Map<string, Map<string, WordEntry>>()
    for (const word of vocabulary ?? []) {
      if (!byLanguage.has(word.language)) byLanguage.set(word.language, new Map())
      byLanguage.get(word.language)!.set(word.term, word)
    }
    return texts?.map((text) => {
      const terms = textTerms.get(text.id)
      return terms && vocabulary ? { ...text, progress: measureTerms(terms, byLanguage.get(text.language) ?? new Map()) } : text
    })
  }, [texts, textTerms, vocabulary])
  // Texts saved before word counts were stored are counted once per change of the list, not per render.
  const wordCounts = useMemo(
    () => new Map((texts ?? []).map((text) => [text.id, text.wordCount ?? countWords(text.content, text.language)])),
    [texts],
  )
  // Known words per language, from the keys alone ("es:casa"), to decide where difficulty labels make sense.
  const knownByLanguage = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    for (const key of await db.words.where('status').equals('known').primaryKeys()) {
      const language = key.slice(0, key.indexOf(':'))
      counts.set(language, (counts.get(language) ?? 0) + 1)
    }
    return counts
  })
  const knownCount = useMemo(() => [...(knownByLanguage?.values() ?? [])].reduce((sum, n) => sum + n, 0), [knownByLanguage])
  const learningCount = useLiveQuery(() => db.words.where('status').equals('learning').count())
  const streak = useStreak()

  async function remove(text: TextDoc) {
    if (window.confirm(t('library.confirmDelete', { title: text.title }))) await deleteText(text)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={ui.pageTitle}>{t('library.title')}</h1>
          <p className={`${ui.muted} mt-1`}>
            {t('library.known', { n: knownCount })} · {t('library.learning', { n: learningCount ?? 0 })} ·{' '}
            <a href="#/stats" className="font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
              {streak && streak.current > 0 ? `🔥 ${t('stats.streak', { n: streak.current })}` : t('stats.link')} →
            </a>
          </p>
        </div>
        <a href="#/new" className={ui.primaryButton}>
          <span aria-hidden="true">+</span> {t('library.new')}
        </a>
      </div>

      <Onboarding texts={texts ?? []} hasWords={(knownCount) + (learningCount ?? 0) > 0} />
      <BackupReminder wordCount={(knownCount) + (learningCount ?? 0)} />

      {texts && texts.length === 0 ? (
        <div className={`${ui.card} p-10 text-center`}>
          <p className={ui.muted}>{t('library.empty')}</p>
        </div>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {libraryTexts?.map((text) => (
          <li key={text.id} className={`${ui.card} group relative flex flex-col gap-3 p-4 transition hover:border-indigo-300 dark:hover:border-indigo-500/50`}>
            <a href={`#/read/${text.id}`} className="flex flex-col gap-2 after:absolute after:inset-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="w-fit rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  {languageName(text.language, uiLanguage)}
                </span>
                {text.progress && text.progress.total > 0 && (knownByLanguage?.get(text.language) ?? 0) >= MIN_KNOWN_FOR_DIFFICULTY ? (
                  <DifficultyBadge progress={text.progress} compact />
                ) : null}
              </span>
              <span dir="auto" lang={text.language} className="font-reading text-lg leading-snug font-semibold text-stone-900 dark:text-stone-50">
                {text.title}
              </span>
              <span dir="auto" lang={text.language} className="line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                {text.content.slice(0, 300)}
              </span>
            </a>
            {text.progress && text.progress.total > 0 ? <ProgressBar progress={text.progress} /> : null}
            <div className="mt-auto flex items-center justify-between">
              <span className="text-xs text-stone-400 tabular-nums">
                {text.kind === 'pdf'
                  ? t('library.pages', { n: text.pageCount ?? 0 })
                  : t('library.words', { n: wordCounts.get(text.id) ?? 0 })}
                {text.progress && text.progress.total > 0
                  ? ` · ${t('library.progress', { p: Math.round((text.progress.known / text.progress.total) * 100) })}`
                  : ''}
              </span>
              <button
                type="button"
                onClick={() => remove(text)}
                className={`${ui.ghostButton} relative z-10 opacity-70 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100`}
              >
                {t('library.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Known (green) and learning (yellow) share of a text's unique words. */
function ProgressBar({ progress }: { progress: NonNullable<TextDoc['progress']> }) {
  const known = (progress.known / progress.total) * 100
  const learning = (progress.learning / progress.total) * 100
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" aria-hidden="true">
      <div className="bg-emerald-500" style={{ width: `${known}%` }} />
      <div className="bg-amber-400" style={{ width: `${learning}%` }} />
    </div>
  )
}
