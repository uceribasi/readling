import { WordMemory } from '../components/WordMemory'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { HighlightedSentence } from '../components/HighlightedSentence'
import { SpeakButton } from '../components/SpeakButton'
import { ui } from '../components/ui'
import { db, deleteWord, setWordStatus, type WordEntry } from '../lib/db'
import { csvCell, downloadFile, relativeTime } from '../lib/format'
import { useNow } from '../lib/hooks'
import { useT, useUiLanguage, type MessageKey } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { clozeParts, isWeak } from '../lib/quiz'
import { displayTerm } from '../lib/phrases'

type Filter = 'all' | 'learning' | 'known' | 'weak' | 'ignored'

const FILTERS: { id: Filter; label: MessageKey }[] = [
  { id: 'all', label: 'words.filterAll' },
  { id: 'learning', label: 'words.filterLearning' },
  { id: 'known', label: 'words.filterKnown' },
  { id: 'weak', label: 'words.filterWeak' },
  { id: 'ignored', label: 'words.filterIgnored' },
]

const PAGE_SIZE = 200

function matchesFilter(word: WordEntry, filter: Filter): boolean {
  if (filter === 'weak') return word.status !== 'ignored' && isWeak(word)
  if (filter === 'all') return word.status !== 'ignored'
  return word.status === filter
}

export function WordsPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const now = useNow()
  const words = useLiveQuery(() => db.words.orderBy('key').toArray())
  const [language, setLanguage] = useState('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const languages = useMemo(() => [...new Set((words ?? []).map((word) => word.language))].sort(), [words])
  const inLanguage = useMemo(
    () => (words ?? []).filter((word) => language === 'all' || word.language === language),
    [words, language],
  )
  const summary = useMemo(
    () => ({
      known: inLanguage.filter((word) => word.status === 'known').length,
      learning: inLanguage.filter((word) => word.status === 'learning').length,
      weak: inLanguage.filter((word) => word.status !== 'ignored' && isWeak(word)).length,
    }),
    [inLanguage],
  )
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return inLanguage
      .filter((word) => matchesFilter(word, filter))
      .filter((word) => !query || displayTerm(word.term, word.language).includes(query) || word.translation?.toLocaleLowerCase().includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [inLanguage, filter, search])

  function exportCsv() {
    const header = ['word', 'translation', 'meaning', 'example', 'context', 'language', 'status'].join(',')
    const rows = visible.map((word) =>
      [
        displayTerm(word.term, word.language),
        word.translation,
        word.explanation?.meaning,
        word.explanation?.example,
        word.context,
        word.language,
        word.status,
      ]
        .map(csvCell)
        .join(','),
    )
    // The BOM makes Excel read UTF-8 correctly; Anki ignores it.
    downloadFile(`readling-words-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${[header, ...rows].join('\n')}`, 'text/csv')
  }

  async function remove(word: WordEntry) {
    if (window.confirm(t('words.confirmDelete', { word: displayTerm(word.term, word.language) }))) await deleteWord(word.key)
  }

  if (words === undefined) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={ui.pageTitle}>{t('words.title')}</h1>
          <p className={`${ui.muted} mt-1`}>
            {t('words.summary', { known: summary.known, learning: summary.learning, weak: summary.weak })}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} disabled={visible.length === 0} className={ui.secondaryButton}>
            {t('words.exportCsv')}
          </button>
          <a href={`#/quiz${language === 'all' ? '' : `/${language}`}`} className={ui.primaryButton}>
            {t('words.startQuiz')}
          </a>
        </div>
      </div>

      {words.length === 0 ? (
        <div className={`${ui.card} flex flex-col items-center gap-2 p-10 text-center`}>
          <p className="font-medium text-stone-800 dark:text-stone-100">{t('words.empty')}</p>
          <p className={ui.muted}>{t('words.emptyHint')}</p>
          <a href="#/" className={`${ui.secondaryButton} mt-2`}>
            {t('nav.library')}
          </a>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setLimit(PAGE_SIZE)
              }}
              placeholder={t('words.search')}
              aria-label={t('words.search')}
              className={`${ui.input} sm:max-w-xs`}
            />
            {languages.length > 1 ? (
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                aria-label={t('settings.languages')}
                className={`${ui.input} sm:w-44`}
              >
                <option value="all">{t('words.allLanguages')}</option>
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, uiLanguage)}
                  </option>
                ))}
              </select>
            ) : null}
            <div role="tablist" className="flex flex-wrap gap-1">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => {
                    setFilter(item.id)
                    setLimit(PAGE_SIZE)
                  }}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                    filter === item.id
                      ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                      : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-400 dark:hover:bg-stone-800'
                  }`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className={`${ui.muted} py-6 text-center`}>{t('words.noMatch')}</p>
          ) : (
            <ul className={`${ui.card} divide-y divide-stone-200 dark:divide-stone-800`}>
              {visible.slice(0, limit).map((word) => (
                <WordRow
                  key={word.key}
                  word={word}
                  now={now}
                  showLanguage={language === 'all' && languages.length > 1}
                  onRemove={() => void remove(word)}
                />
              ))}
            </ul>
          )}

          {visible.length > limit ? (
            <button type="button" onClick={() => setLimit(limit + PAGE_SIZE)} className={`${ui.secondaryButton} self-center`}>
              {t('words.showMore', { n: visible.length - limit })}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}

const STATUS_PILL = {
  learning: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  known: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  ignored: 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
} as const

const STATUS_LABEL: Record<WordEntry['status'], MessageKey> = {
  learning: 'words.statusLearning',
  known: 'words.statusKnown',
  ignored: 'words.statusIgnored',
}

function WordRow({
  word,
  now,
  showLanguage,
  onRemove,
}: {
  word: WordEntry
  now: number
  showLanguage: boolean
  onRemove: () => void
}) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const stats = word.quiz
  const [memoryOpen, setMemoryOpen] = useState(false)
  const due = word.status === 'learning' && word.card ? new Date(word.card.due) : undefined
  const surface = clozeParts(word)?.surface ?? displayTerm(word.term, word.language)

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span lang={word.language} dir="auto" className="font-reading text-lg font-semibold text-stone-900 dark:text-stone-50">
            {displayTerm(word.term, word.language)}
          </span>
          <SpeakButton text={displayTerm(word.term, word.language)} language={word.language} className="-my-2 size-7 self-center" />
          {word.translation ? (
            <span className="text-indigo-700 dark:text-indigo-300">{word.translation}</span>
          ) : (
            <span className="text-sm text-stone-400 italic">{t('words.noTranslation')}</span>
          )}
          {showLanguage ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {languageName(word.language, uiLanguage)}
            </span>
          ) : null}
        </div>
        {word.context ? (
          <p lang={word.language} dir="auto" className="font-reading mt-1 line-clamp-1 text-sm text-stone-500 dark:text-stone-400">
            <HighlightedSentence sentence={word.context} surface={surface} />
          </p>
        ) : null}
        <button type="button" className={`${ui.ghostButton} -ml-2 mt-1 text-xs`} aria-expanded={memoryOpen} onClick={() => setMemoryOpen(!memoryOpen)}>{t('memory.details')}</button>
        {memoryOpen ? <WordMemory language={word.language} term={word.term} /> : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 sm:justify-end dark:text-stone-400">
        <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_PILL[word.status]}`}>{t(STATUS_LABEL[word.status])}</span>
        {due ? (
          <span>{due.getTime() <= now ? t('words.dueNow') : t('words.dueAt', { when: relativeTime(due, now, uiLanguage) })}</span>
        ) : null}
        {stats ? (
          <span className={isWeak(word) ? 'font-medium text-red-600 dark:text-red-400' : ''}>
            {t('words.accuracy', {
              percent: Math.round((stats.correct / (stats.correct + stats.wrong)) * 100),
              n: stats.correct + stats.wrong,
            })}
          </span>
        ) : null}
        <span className="flex gap-1">
          {word.status === 'learning' ? (
            <button type="button" onClick={() => void setWordStatus(word.language, word.term, 'known')} className={ui.ghostButton}>
              {t('words.markKnown')}
            </button>
          ) : (
            <button type="button" onClick={() => void setWordStatus(word.language, word.term, 'learning')} className={ui.ghostButton}>
              {t('words.markLearning')}
            </button>
          )}
          <button type="button" onClick={onRemove} className={ui.ghostButton} aria-label={t('words.delete')} title={t('words.delete')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
            </svg>
          </button>
        </span>
      </div>
    </li>
  )
}
