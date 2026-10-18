import { useDeferredValue, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { TextInfo } from '../components/Difficulty'
import { StoryGenerator } from '../components/StoryGenerator'
import { ui } from '../components/ui'
import { WikipediaSearch } from '../components/WikipediaSearch'
import { addText, db, newId, requestPersistentStorage } from '../lib/db'
import { EpubError, readEpub, type EpubBook } from '../lib/epub'
import { useT, useUiLanguage, type MessageKey } from '../lib/i18n'
import { LANGUAGES, languageName, supportedLanguage, textDirection } from '../lib/languages'
import { inspectPdf, PdfError, type PdfInfo } from '../lib/pdf'
import { navigate } from '../lib/router'
import { updateSettings, useSettings } from '../lib/settings'
import type { WikiArticle } from '../lib/wikipedia'

type Mode = 'paste' | 'file' | 'wikipedia' | 'generate'
type FileStatus = { status: 'idle' } | { status: 'loading'; kind: 'pdf' | 'book' } | { status: 'error'; message: string }
type Upload = { kind: 'pdf'; file: File; info: PdfInfo } | { kind: 'book'; file: File; book: EpubBook }

const ACCEPT = '.txt,text/plain,.pdf,application/pdf,.epub,application/epub+zip'

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function isEpub(file: File): boolean {
  return file.type === 'application/epub+zip' || /\.epub$/i.test(file.name)
}

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

export function NewTextPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const [mode, setMode] = useState<Mode>('paste')
  // What the person typed; when empty, the title comes from what was imported in the current tab.
  const [title, setTitle] = useState('')
  const [autoTitles, setAutoTitles] = useState<Record<Mode, string>>({ paste: '', file: '', wikipedia: '', generate: '' })
  const [language, setLanguage] = useState(settings.lastTextLanguage)
  const [content, setContent] = useState('')
  const [upload, setUpload] = useState<Upload | null>(null)
  const [article, setArticle] = useState<WikiArticle | null>(null)
  const [story, setStory] = useState('')
  const [fileStatus, setFileStatus] = useState<FileStatus>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Only the most recently chosen file may update the form, even if an earlier one finishes later.
  const latestLoad = useRef(0)

  const deferredContent = useDeferredValue(content)
  const deferredStory = useDeferredValue(story)
  const draft =
    mode === 'paste'
      ? deferredContent.trim()
      : mode === 'generate'
        ? deferredStory.trim()
        : mode === 'file' && upload?.kind === 'book'
        ? upload.book.text
        : mode === 'wikipedia' && article
          ? article.text
          : ''

  const setAutoTitle = (forMode: Mode, value: string) => setAutoTitles((titles) => ({ ...titles, [forMode]: value }))

  async function loadFile(file: File) {
    const load = ++latestLoad.current
    const isLatest = () => load === latestLoad.current
    if (!isPdf(file) && !isEpub(file)) {
      // Plain text goes into the editor so it can be checked and trimmed before reading.
      const text = await file.text()
      if (!isLatest()) return
      setFileStatus({ status: 'idle' })
      setContent(text)
      setAutoTitle('paste', file.name.replace(/\.[^.]+$/, ''))
      setMode('paste')
      return
    }
    setMode('file')
    setUpload(null)
    setAutoTitle('file', '')
    setFileStatus({ status: 'loading', kind: isPdf(file) ? 'pdf' : 'book' })
    try {
      if (isPdf(file)) {
        // The PDF is kept as is and rendered in the reader; this only checks it has selectable text.
        const info = await inspectPdf(file)
        if (!isLatest()) return
        setUpload({ kind: 'pdf', file, info })
        setAutoTitle('file', file.name.replace(/\.[^.]+$/, ''))
      } else {
        const book = await readEpub(file)
        if (!isLatest()) return
        setUpload({ kind: 'book', file, book })
        setAutoTitle('file', book.title)
        const bookLanguage = supportedLanguage(book.language)
        if (bookLanguage) setLanguage(bookLanguage)
      }
      setFileStatus({ status: 'idle' })
    } catch (error) {
      if (!isLatest()) return
      const message =
        error instanceof EpubError
          ? t(`new.epub-${error.code}` as MessageKey)
          : t(`new.pdf-${error instanceof PdfError ? error.code : 'invalid'}` as MessageKey)
      setFileStatus({ status: 'error', message })
    }
  }

  function pickArticle(picked: WikiArticle) {
    setArticle(picked)
    setAutoTitle('wikipedia', picked.title)
  }

  function onDrop(event: DragEvent) {
    if (!isFileDrag(event)) return
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void loadFile(file)
  }

  const shownTitle = title || autoTitles[mode]
  const pdf = mode === 'file' && upload?.kind === 'pdf' ? upload : null
  const canSave = Boolean(pdf || draft) && !saving && fileStatus.status !== 'loading'

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setSaving(true)
    const title = shownTitle.trim() || t('new.untitled')
    let id: number
    if (pdf) {
      const now = Date.now()
      const fileId = newId()
      id = await db.transaction('rw', db.texts, db.files, async () => {
        await db.files.add({ id: fileId, name: pdf.file.name, type: pdf.file.type, blob: pdf.file, createdAt: now })
        return db.texts.add({
          title,
          language,
          kind: 'pdf',
          fileId,
          pageCount: pdf.info.numPages,
          content: pdf.info.preview,
          createdAt: now,
          updatedAt: now,
        })
      })
    } else {
      // The editable texts are read directly, in case the deferred copy is a keystroke behind.
      const body = mode === 'paste' ? content.trim() : mode === 'generate' ? story.trim() : draft
      id = await addText({ title, language, content: body, sourceUrl: mode === 'wikipedia' ? article?.url : undefined })
    }
    updateSettings({ lastTextLanguage: language })
    void requestPersistentStorage()
    navigate(`/read/${id}`)
  }

  return (
    <form
      onSubmit={save}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
      className="mx-auto flex max-w-3xl flex-col gap-5"
    >
      <h1 className={ui.pageTitle}>{t('new.title')}</h1>

      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor="title" className={ui.label}>
            {t('new.titleLabel')}
          </label>
          <input
            id="title"
            dir="auto"
            value={shownTitle}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('new.titlePlaceholder')}
            className={ui.input}
          />
        </div>
        <div>
          <label htmlFor="language" className={ui.label}>
            {t('new.languageLabel')}
          </label>
          <select
            id="language"
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value)
              // An article belongs to one language's Wikipedia.
              setArticle(null)
              setAutoTitle('wikipedia', '')
            }}
            className={ui.input}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {languageName(code, uiLanguage)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label={t('new.contentLabel')}
          className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1 sm:flex sm:w-fit dark:border-stone-800 dark:bg-stone-900"
        >
          <ModeTab selected={mode === 'paste'} onSelect={() => setMode('paste')} icon={<PasteIcon />}>
            {t('new.modePaste')}
          </ModeTab>
          <ModeTab selected={mode === 'file'} onSelect={() => setMode('file')} icon={<UploadIcon />}>
            {t('new.modeFile')}
          </ModeTab>
          <ModeTab selected={mode === 'wikipedia'} onSelect={() => setMode('wikipedia')} icon={<GlobeIcon />}>
            {t('new.modeWikipedia')}
          </ModeTab>
          <ModeTab selected={mode === 'generate'} onSelect={() => setMode('generate')} icon={<SparkleIcon />}>
            {t('new.modeGenerate')}
          </ModeTab>
        </div>

        <div className="relative">
          {mode === 'paste' ? (
            <textarea
              id="content"
              aria-label={t('new.contentLabel')}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t('new.contentPlaceholder')}
              rows={16}
              lang={language}
              dir={textDirection(language)}
              className={`${ui.input} font-reading text-base leading-relaxed`}
            />
          ) : mode === 'generate' ? (
            <div className="flex flex-col gap-3">
              <StoryGenerator
                language={language}
                onWritten={(written) => {
                  setStory(written.text)
                  setAutoTitle('generate', written.title)
                }}
              />
              {story ? (
                <div>
                  <label htmlFor="story-text" className={ui.label}>
                    {t('story.result')}
                  </label>
                  <textarea
                    id="story-text"
                    value={story}
                    onChange={(event) => setStory(event.target.value)}
                    rows={12}
                    lang={language}
                    dir={textDirection(language)}
                    className={`${ui.input} font-reading text-base leading-relaxed`}
                  />
                </div>
              ) : null}
            </div>
          ) : mode === 'wikipedia' ? (
            article ? (
              <ImportedCard
                badge="W"
                badgeClass="bg-stone-100 font-serif text-stone-700 dark:bg-stone-800 dark:text-stone-200"
                name={article.title}
                meta={<a href={article.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{t('new.wikiSource')}</a>}
                preview={article.text}
                language={language}
                actions={
                  <button type="button" onClick={() => setArticle(null)} className={ui.ghostButton}>
                    {t('new.importChange')}
                  </button>
                }
              />
            ) : (
              // Results belong to one language's Wikipedia, so switching languages starts over.
              <WikipediaSearch key={language} language={language} onPick={pickArticle} />
            )
          ) : upload ? (
            <ImportedCard
              badge={upload.kind === 'pdf' ? 'PDF' : 'EPUB'}
              badgeClass={
                upload.kind === 'pdf'
                  ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300'
                  : 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
              }
              name={upload.kind === 'book' ? upload.book.title : upload.file.name}
              meta={
                upload.kind === 'pdf'
                  ? t('new.pdfPageCount', { n: upload.info.numPages })
                  : [upload.book.author, t('new.bookChapters', { n: upload.book.chapters })].filter(Boolean).join(' · ')
              }
              preview={upload.kind === 'pdf' ? upload.info.preview : upload.book.text}
              language={language}
              actions={
                <>
                  <label className={`${ui.ghostButton} cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500`}>
                    {t('new.pdfChange')}
                    <FileInput onFile={loadFile} />
                  </label>
                  <button type="button" onClick={() => setUpload(null)} className={ui.ghostButton}>
                    {t('new.pdfRemove')}
                  </button>
                </>
              }
            />
          ) : (
            <label className="flex min-h-[22rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-stone-300 bg-white px-6 py-10 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-indigo-500/60 dark:hover:bg-indigo-500/5">
              <span className="flex size-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <UploadIcon className="size-7" />
              </span>
              <span className="text-base font-medium text-stone-900 dark:text-stone-50">{t('new.dropTitle')}</span>
              <span className={ui.muted}>{t('new.dropOr')}</span>
              <span className={ui.primaryButton}>{t('new.chooseFile')}</span>
              <span className="mt-2 max-w-sm text-xs text-stone-500 dark:text-stone-400">{t('new.dropNote')}</span>
              <FileInput onFile={loadFile} />
            </label>
          )}

          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-50/90 text-base font-medium text-indigo-700 dark:bg-indigo-950/90 dark:text-indigo-200">
              <span className="flex items-center gap-2">
                <UploadIcon className="size-5" /> {t('new.dropActive')}
              </span>
            </div>
          ) : null}
        </div>

        <TextInfo text={draft} language={language} />
        {fileStatus.status === 'loading' && mode === 'file' ? (
          <p className={ui.muted} role="status">
            {t(fileStatus.kind === 'pdf' ? 'new.pdfLoading' : 'new.bookLoading')}
          </p>
        ) : null}
        {fileStatus.status === 'error' && mode === 'file' ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
            {fileStatus.message}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <a href="#/" className={ui.secondaryButton}>
          {t('new.cancel')}
        </a>
        <button type="submit" disabled={!canSave} className={ui.primaryButton}>
          {t('new.save')}
        </button>
      </div>
    </form>
  )
}

/** A file or article that's ready to save: what it is, a short preview, and ways to change it. */
function ImportedCard({
  badge,
  badgeClass,
  name,
  meta,
  preview,
  language,
  actions,
}: {
  badge: string
  badgeClass: string
  name: string
  meta: ReactNode
  preview: string
  language: string
  actions: ReactNode
}) {
  return (
    <div className={`${ui.card} flex items-start gap-4 p-4`}>
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${badgeClass}`}>
        {badge}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-stone-900 dark:text-stone-50">{name}</p>
        <p className={ui.muted}>{meta}</p>
        <p lang={language} dir="auto" className="font-reading mt-2 line-clamp-3 text-sm text-stone-600 dark:text-stone-400">
          {preview.slice(0, 400)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row">{actions}</div>
    </div>
  )
}

function ModeTab({
  selected,
  onSelect,
  icon,
  children,
}: {
  selected: boolean
  onSelect: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
        selected
          ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200 dark:bg-stone-700 dark:text-white dark:ring-stone-600'
          : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function FileInput({ onFile }: { onFile: (file: File) => void }) {
  return (
    <input
      type="file"
      accept={ACCEPT}
      className="sr-only"
      onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) onFile(file)
        event.target.value = ''
      }}
    />
  )
}

function SparkleIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  )
}

function GlobeIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

function UploadIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 15V3m0 0-4 4m4-4 4 4" />
      <path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
    </svg>
  )
}

function PasteIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1" />
      <path d="M9 12h6M9 16h4" />
    </svg>
  )
}
