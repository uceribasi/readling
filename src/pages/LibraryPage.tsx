import { useLiveQuery } from 'dexie-react-hooks'
import { useDeferredValue, useMemo, useState } from 'react'
import { BackupReminder } from '../components/BackupReminder'
import { DifficultyBadge } from '../components/Difficulty'
import { Onboarding } from '../components/Onboarding'
import { ui } from '../components/ui'
import { db, deleteText, type TextDoc, type WordEntry } from '../lib/db'
import { measureTerms, MIN_KNOWN_FOR_DIFFICULTY } from '../lib/difficulty'
import { useStreak } from '../lib/hooks'
import { useT, useUiLanguage } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { filterLibrary, readingStatus, type ReadingStatus } from '../lib/library'
import { recommendTexts } from '../lib/daily'
import { countWords, tokenize, uniqueTerms } from '../lib/tokenize'

export function LibraryPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [language, setLanguage] = useState('')
  const [status, setStatus] = useState('')
  const [collection, setCollection] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
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
  const collections = useMemo(() => [...new Set((texts ?? []).map((text) => text.collection).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, uiLanguage)), [texts, uiLanguage])
  const languages = useMemo(() => [...new Set((texts ?? []).map((text) => text.language))], [texts])
  const filtered = useMemo(() => filterLibrary(libraryTexts ?? [], { query: deferredQuery, language, status, collection }), [libraryTexts, deferredQuery, language, status, collection])
  const recommendations = useMemo(() => vocabulary ? recommendTexts(texts ?? [], vocabulary, { language: language || undefined }).slice(0, 3) : [], [texts, vocabulary, language])
  const hasFilters = Boolean(query || language || status || collection)
  const clearFilters = () => { setQuery(''); setLanguage(''); setStatus(''); setCollection('') }


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

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
        <div>
          <h2 className="font-semibold text-indigo-950 dark:text-indigo-100">{t('libraryFeatures.daily')}</h2>
          <p className="mt-1 text-sm text-indigo-800 dark:text-indigo-200/80">{t('libraryFeatures.dailyNote')}</p>
        </div>
        <a href="#/daily" className={ui.primaryButton}>{t('libraryFeatures.startDaily')} →</a>
      </section>

      <Onboarding texts={texts ?? []} hasWords={(knownCount) + (learningCount ?? 0) > 0} />
      <BackupReminder wordCount={(knownCount) + (learningCount ?? 0)} />

      {texts && texts.length === 0 ? (
        <div className={`${ui.card} p-10 text-center`}>
          <p className={ui.muted}>{t('library.empty')}</p>
        </div>
      ) : null}

      {texts?.length ? <>
        <div className="space-y-3">
          <label className="block">
            <span className={ui.label}>{t('libraryFeatures.search')}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('libraryFeatures.searchPlaceholder')} className={ui.input} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={t('libraryFeatures.allLanguages')} className={ui.input}>
              <option value="">{t('libraryFeatures.allLanguages')}</option>
              {languages.map((value) => <option key={value} value={value}>{languageName(value, uiLanguage)}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={t('libraryFeatures.status')} className={ui.input}>
              <option value="">{t('libraryFeatures.allStatuses')}</option>
              {(['unread', 'reading', 'finished'] as const).map((value) => <option key={value} value={value}>{t(`libraryFeatures.${value}`)}</option>)}
            </select>
            <select value={collection} onChange={(event) => setCollection(event.target.value)} aria-label={t('libraryFeatures.collection')} className={ui.input}>
              <option value="">{t('libraryFeatures.allCollections')}</option>
              <option value="__none__">{t('libraryFeatures.noCollection')}</option>
              {collections.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className={ui.muted} role="status">{t('libraryFeatures.results', { n: filtered.length, total: texts.length })}</p>
            {hasFilters ? <button type="button" onClick={clearFilters} className={ui.ghostButton}>{t('libraryFeatures.clear')}</button> : null}
          </div>
        </div>
        {!hasFilters && recommendations.length ? <section aria-label={t('libraryFeatures.recommended')}>
          <h2 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-200">{t('libraryFeatures.recommended')}</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {recommendations.map(({ text, coverage, practiceTerms }) => <a key={text.id} href={`#/read/${text.id}`} className="rounded-lg border border-stone-200 p-3 transition hover:border-indigo-400 dark:border-stone-800 dark:hover:border-indigo-500">
              <span dir="auto" className="block truncate text-sm font-medium text-stone-800 dark:text-stone-100">{text.title}</span>
              <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{t('libraryFeatures.recommendReason', { p: Math.round(coverage * 100), n: practiceTerms })}</span>
            </a>)}
          </div>
        </section> : null}
        {!filtered.length ? <div className={`${ui.card} p-8 text-center`}><p className={ui.muted}>{t('libraryFeatures.noResults')}</p><button type="button" onClick={clearFilters} className={`${ui.ghostButton} mt-2`}>{t('libraryFeatures.clear')}</button></div> : null}
      </> : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((text) => (
          <li key={text.id} className={`${ui.card} group relative flex flex-col gap-3 p-4 transition hover:border-indigo-300 dark:hover:border-indigo-500/50`}>
            <a href={`#/read/${text.id}`} className="flex flex-col gap-2 after:absolute after:inset-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="w-fit rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  {languageName(text.language, uiLanguage)}
                </span>
                {text.progress && text.progress.total > 0 && (knownByLanguage?.get(text.language) ?? 0) >= MIN_KNOWN_FOR_DIFFICULTY ? (
                  <DifficultyBadge progress={text.progress} compact />
                ) : null}
                <span className="text-xs text-stone-500 dark:text-stone-400">{t(`libraryFeatures.${readingStatus(text)}`)}</span>
                {text.collection ? <span className="max-w-full truncate text-xs text-indigo-700 dark:text-indigo-300">{text.collection}</span> : null}
              </span>
              <span dir="auto" lang={text.language} className="font-reading text-lg leading-snug font-semibold text-stone-900 dark:text-stone-50">
                {text.title}
              </span>
              <span dir="auto" lang={text.language} className="line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                {text.content.slice(0, 300)}
              </span>
            </a>
            {text.progress && text.progress.total > 0 ? <ProgressBar progress={text.progress} /> : null}
            {editing === text.id ? <LibraryEditor text={text} collections={collections} onClose={() => setEditing(null)} /> : null}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-stone-400 tabular-nums">
                {text.kind === 'pdf'
                  ? t('library.pages', { n: text.pageCount ?? 0 })
                  : t('library.words', { n: wordCounts.get(text.id) ?? 0 })}
                {text.progress && text.progress.total > 0
                  ? ` · ${t('library.progress', { p: Math.round((text.progress.known / text.progress.total) * 100) })}`
                  : ''}
              </span>
              <div className="relative z-10 flex gap-1">
              <button type="button" onClick={() => setEditing(editing === text.id ? null : text.id)} aria-expanded={editing === text.id} className={ui.ghostButton}>{t('libraryFeatures.organize')}</button>
              <button
                type="button"
                onClick={() => remove(text)}
                className={`${ui.ghostButton} relative z-10 opacity-70 hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100`}
              >
                {t('library.delete')}
              </button>
              </div>
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

function LibraryEditor({ text, collections, onClose }: { text: TextDoc; collections: string[]; onClose: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<ReadingStatus>(readingStatus(text))
  const [collection, setCollection] = useState(text.collection ?? '')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  async function save() {
    setSaving(true)
    setFailed(false)
    try { await db.texts.update(text.id, { readingStatus: status, collection: collection.trim().slice(0, 120) || undefined, updatedAt: Date.now() }); onClose() }
    catch { setFailed(true) }
    finally { setSaving(false) }
  }
  return <div className="relative z-10 space-y-3 rounded-lg bg-stone-50 p-3 dark:bg-stone-800">
    <label className="block"><span className={ui.label}>{t('libraryFeatures.status')}</span><select value={status} onChange={(event) => setStatus(event.target.value as ReadingStatus)} className={ui.input}>
      {(['unread', 'reading', 'finished'] as const).map((value) => <option key={value} value={value}>{t(`libraryFeatures.${value}`)}</option>)}
    </select></label>
    <label className="block"><span className={ui.label}>{t('libraryFeatures.collection')}</span><input value={collection} maxLength={120} onChange={(event) => setCollection(event.target.value)} list={`collections-${text.id}`} className={ui.input} placeholder={t('libraryFeatures.collectionPlaceholder')} /></label>
    <datalist id={`collections-${text.id}`}>{collections.map((value) => <option key={value} value={value} />)}</datalist>
    <div className="flex gap-2"><button type="button" onClick={() => void save()} disabled={saving} className={ui.primaryButton}>{t('libraryFeatures.save')}</button><button type="button" onClick={onClose} disabled={saving} className={ui.ghostButton}>{t('libraryFeatures.cancel')}</button></div>
    {failed ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('libraryFeatures.saveError')}</p> : null}
  </div>
}
