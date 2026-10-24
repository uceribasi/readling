import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useMemo, useState } from 'react'
import { db, newId, type TextDoc } from '../lib/db'
import { useT } from '../lib/i18n'
import { clampReadingPage, locationAt, searchReaderText, type ReaderLocation, type TextSearchMatch } from '../lib/library'
import { ui } from './ui'

export function ReaderTools({ text, page, totalPages, onNavigate, locations, searchContent, searchSource }: {
  text: TextDoc
  page: number
  totalPages: number
  onNavigate: (page: number, match?: TextSearchMatch) => void
  locations?: ReaderLocation[]
  searchContent?: string
  searchSource?: (signal: AbortSignal) => Promise<{ content: string; locations: ReaderLocation[] }>
}) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState<{ content: string; locations: ReaderLocation[] } | null>(null)
  const [prepareSearch, setPrepareSearch] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  useEffect(() => {
    if (!prepareSearch || !searchSource) return
    const controller = new AbortController()
    void searchSource(controller.signal).then((index) => { if (!controller.signal.aborted) { setSearchIndex(index); setPrepareSearch(false) } }, () => { if (!controller.signal.aborted) { setSearchFailed(true); setPrepareSearch(false) } })
    return () => controller.abort()
  }, [prepareSearch, searchSource])
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const stored = useLiveQuery(() => db.texts.get(text.id), [text.id])
  const bookmarks = stored?.bookmarks ?? text.bookmarks ?? []
  const results = useMemo(() => searchReaderText(searchContent ?? searchIndex?.content ?? '', query, locations ?? searchIndex?.locations ?? []), [searchContent, searchIndex, query, locations])

  async function saveBookmark() {
    setBusy(true)
    setError(false)
    try {
      await db.transaction('rw', db.texts, async () => {
        const current = await db.texts.get(text.id)
        if (!current) throw new Error('missing-text')
        const previous = current.bookmarks?.find((bookmark) => bookmark.id === editing)
        const now = Date.now()
        const bookmark = {
          id: previous?.id ?? newId(), page: previous?.page ?? page,
          label: label.trim() || t('reader.page', { n: (previous?.page ?? page) + 1, total: totalPages }),
          note: note.trim(), createdAt: previous?.createdAt ?? now, updatedAt: now,
        }
        await db.texts.update(text.id, {
          bookmarks: [...(current.bookmarks ?? []).filter((item) => item.id !== bookmark.id), bookmark].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
          updatedAt: now,
        })
      })
      setEditing(null)
      setLabel('')
      setNote('')
      setSaved(true)
    } catch { setError(true) } finally { setBusy(false) }
  }

  async function removeBookmark(bookmarkId: string) {
    setError(false)
    try {
      await db.transaction('rw', db.texts, async () => {
        const current = await db.texts.get(text.id)
        if (current) {
          const now = Date.now()
          await db.texts.update(text.id, {
            bookmarks: current.bookmarks?.filter((bookmark) => bookmark.id !== bookmarkId),
            bookmarkDeletions: [...(current.bookmarkDeletions ?? []).filter((deletion) => deletion.id !== bookmarkId), { id: bookmarkId, deletedAt: now }],
            updatedAt: now,
          })
        }
      })
      if (editing === bookmarkId) { setEditing(null); setLabel(''); setNote('') }
    } catch { setError(true) }
  }

  return (
    <section className={`${ui.card} mt-4 overflow-hidden`} aria-label={t('libraryTools.title')}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`${id}-panel`} className={ui.ghostButton}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {t('libraryTools.title')}
          {bookmarks.length ? <span className="rounded-full bg-indigo-50 px-1.5 text-xs text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{bookmarks.length}</span> : null}
        </button>
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          {t('libraryTools.goToPage')}
          <input key={`${page}:${totalPages}`} type="number" min={1} max={Math.max(1, totalPages)} defaultValue={page + 1} className={`${ui.input} !w-20`} aria-label={t('libraryTools.goToPage')}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value) && value - 1 !== page) onNavigate(clampReadingPage(value - 1, totalPages)) } }}
            onBlur={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value) && value - 1 !== page) onNavigate(clampReadingPage(value - 1, totalPages)) }} />
          <span className="tabular-nums">/ {Math.max(1, totalPages)}</span>
        </label>
      </div>
      {open ? <div id={`${id}-panel`} className="space-y-5 border-t border-stone-200 p-4 dark:border-stone-800">
        {text.chapters?.length && locations ? <div>
          <label htmlFor={`${id}-chapter`} className={ui.label}>{t('libraryTools.contents')}</label>
          <select id={`${id}-chapter`} value="" onChange={(event) => { const chapter = text.chapters?.[Number(event.target.value)]; if (chapter) { const location = locationAt(locations, chapter.start); onNavigate(location?.page ?? 0, { start: chapter.start, end: chapter.start, excerpt: '', page: location?.page ?? 0, sentence: location?.sentence }) } }} className={ui.input}>
            <option value="" disabled>{t('libraryTools.chooseChapter')}</option>
            {text.chapters.map((chapter, index) => <option key={`${chapter.start}:${index}`} value={index}>{chapter.title}</option>)}
          </select>
        </div> : null}
        {searchSource && !searchIndex ? <div><button type="button" onClick={() => { setSearchFailed(false); setPrepareSearch(true) }} disabled={prepareSearch} className={ui.secondaryButton}>{t(prepareSearch ? 'libraryTools.preparingSearch' : 'libraryTools.prepareSearch')}</button>{searchFailed ? <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{t('libraryTools.searchError')}</p> : null}</div> : null}
        {searchContent !== undefined || searchIndex ? <div>
          <label htmlFor={`${id}-search`} className={ui.label}>{t('libraryTools.search')}</label>
          <input id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} className={ui.input} placeholder={t('libraryTools.searchPlaceholder')} />
          {query.trim() ? <div className="mt-2">
            <p role="status" className={ui.muted}>{results.length ? t('libraryTools.matches', { n: results.length }) : t('libraryTools.noMatches')}</p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {results.map((match) => <li key={match.start}><button type="button" onClick={() => onNavigate(match.page, match)} className="w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-stone-100 focus-visible:outline-indigo-500 dark:hover:bg-stone-800">
                <span className="mb-1 block text-xs font-medium text-indigo-700 dark:text-indigo-300">{t('reader.page', { n: match.page + 1, total: totalPages })}</span>
                <span dir="auto" lang={text.language} className="text-stone-700 dark:text-stone-200">{match.excerpt}</span>
              </button></li>)}
            </ul>
          </div> : null}
        </div> : null}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-100">{t('libraryTools.bookmarks')}</h2>
          {bookmarks.length ? <ul className="mb-4 max-h-64 space-y-2 overflow-y-auto">{bookmarks.map((bookmark) => <li key={bookmark.id} className="rounded-lg bg-stone-50 p-3 dark:bg-stone-800/60">
            <div className="flex items-start justify-between gap-2">
              <button type="button" className="text-start text-sm font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300" onClick={() => onNavigate(clampReadingPage(bookmark.page, totalPages))}>{bookmark.label}</button>
              <span className="shrink-0 text-xs text-stone-500">{bookmark.page + 1}</span>
            </div>
            {bookmark.note ? <p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-600 dark:text-stone-300">{bookmark.note}</p> : null}
            <div className="mt-2 flex gap-1">
              <button type="button" className={ui.ghostButton} onClick={() => { setEditing(bookmark.id); setLabel(bookmark.label); setNote(bookmark.note); setSaved(false) }}>{t('libraryTools.edit')}</button>
              <button type="button" className={ui.ghostButton} onClick={() => void removeBookmark(bookmark.id)}>{t('libraryTools.remove')}</button>
            </div>
          </li>)}</ul> : <p className={`${ui.muted} mb-3`}>{t('libraryTools.noBookmarks')}</p>}
          <label htmlFor={`${id}-label`} className={ui.label}>{t('libraryTools.bookmarkLabel')}</label>
          <input id={`${id}-label`} value={label} maxLength={160} onChange={(event) => { setLabel(event.target.value); setSaved(false) }} placeholder={t('reader.page', { n: page + 1, total: totalPages })} className={ui.input} />
          <label htmlFor={`${id}-note`} className={`${ui.label} mt-3`}>{t('libraryTools.note')}</label>
          <textarea id={`${id}-note`} value={note} maxLength={5000} onChange={(event) => { setNote(event.target.value); setSaved(false) }} rows={3} className={ui.input} placeholder={t('libraryTools.notePlaceholder')} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} className={ui.secondaryButton} onClick={() => void saveBookmark()}>{t(editing ? 'libraryTools.saveNote' : 'libraryTools.addBookmark')}</button>
            {editing ? <button type="button" onClick={() => { setEditing(null); setLabel(''); setNote('') }} className={ui.ghostButton}>{t('libraryTools.cancel')}</button> : null}
            {saved ? <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{t('libraryTools.saved')}</span> : null}
          </div>
          {error ? <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{t('libraryTools.saveError')}</p> : null}
        </div>
      </div> : null}
    </section>
  )
}
