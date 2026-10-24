import { useLiveQuery } from 'dexie-react-hooks'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ReaderTools } from '../components/ReaderTools'
import { ReadingsToggle, StatusLegend, WordAside } from '../components/ReaderParts'
import { ui } from '../components/ui'
import { WordPanel } from '../components/WordPanel'
import { db, markUntrackedAsKnown, recordPageRead, setWordStatus, type TextDoc, type WordStatus } from '../lib/db'
import { useWordMap, useWordShortcuts } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { clampReadingPage, type ReaderLocation } from '../lib/library'
import { loadPdfjs, openPdfDocument } from '../lib/pdf'
import { caretAt, indexTextLayer, offsetOf, rangeFor, sentenceAt, wordAt, type PageTextIndex, type PageWord } from '../lib/pdfText'
import { buildPhraseIndex, findTextPhrases, MAX_PHRASE_WORDS, phraseTerm } from '../lib/phrases'
import { useReadings } from '../lib/useReadings'

const MAX_PAGE_WIDTH = 860
/** CSS Custom Highlight names; styled with ::highlight() in index.css. */
const HIGHLIGHTS = { new: 'rl-new', learning: 'rl-learning', phrase: 'rl-phrase', selected: 'rl-selected' } as const

interface PdfSelection {
  page: number
  start: number
  end: number
  term: string
  surface: string
  sentence: string
  autoExplain: boolean
}

const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS

/** Reader for PDFs: pages are rendered as they are, and words are picked from pdf.js's text layer. */
export function PdfReader({ text, initialPage }: { text: TextDoc; initialPage?: number }) {
  const t = useT()
  const { language } = text
  const wordMap = useWordMap(language)
  const file = useLiveQuery(() => db.files.get(text.fileId ?? '').then((stored) => stored ?? null), [text.fileId])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(0)
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const [currentPage, setCurrentPage] = useState(() => clampReadingPage(initialPage ?? text.readingPage, text.pageCount ?? Number.MAX_SAFE_INTEGER))
  const resumeTarget = useRef<number | null>(initialPage ?? text.readingPage ?? null)
  const latestPage = useRef(currentPage)
  const columnRef = useRef<HTMLDivElement>(null)
  const layers = useRef(new Map<number, PageTextIndex>())
  // Unique words of each rendered page; also tells effects when a page's text layer changed.
  const [pageTerms, setPageTerms] = useState<ReadonlyMap<number, string[]>>(new Map())
  const [pageWordCounts, setPageWordCounts] = useState<ReadonlyMap<number, number>>(new Map())
  // Set between a phrase selection's mouseup and the click that follows it.
  const phraseJustSelected = useRef(false)
  // PDFs can't show furigana or pinyin over the page, but the word panel can.
  const readings = useReadings(language)
  const phraseIndex = useMemo(
    () => buildPhraseIndex([...wordMap.values()].filter((word) => word.status === 'learning').map((word) => word.term)),
    [wordMap],
  )

  useEffect(() => {
    if (!file) return
    let cancelled = false
    let opened: PDFDocumentProxy | undefined
    openPdfDocument(file.blob).then(
      (loaded) => {
        if (cancelled) void loaded.loadingTask.destroy()
        else setDoc((opened = loaded))
      },
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
      void opened?.loadingTask.destroy()
    }
  }, [file])

  // Pages fill the column; small width changes don't trigger a re-render.
  useEffect(() => {
    const column = columnRef.current
    if (!column) return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.min(MAX_PAGE_WIDTH, Math.floor(entry.contentRect.width))
      setWidth((current) => (Math.abs(current - next) > 24 ? next : current))
    })
    observer.observe(column)
    return () => observer.disconnect()
  }, [])

  const onTextLayer = useCallback(
    (page: number, layer: HTMLElement | null) => {
      if (layer) {
        const index = indexTextLayer(layer, language)
        layers.current.set(page, index)
        setPageTerms((current) => new Map(current).set(page, [...new Set(index.words.map((word) => word.term))]))
        setPageWordCounts((current) => new Map(current).set(page, index.words.length))
        if (resumeTarget.current === page - 1) {
          layer.closest<HTMLElement>('[data-pdf-page]')?.scrollIntoView({ block: 'start' })
          resumeTarget.current = null
        }
      } else {
        layers.current.delete(page)
        setPageTerms((current) => {
          const next = new Map(current)
          next.delete(page)
          return next
        })
      }
    },
    [language],
  )

  // Restore the saved zero-based page once placeholders exist, before scroll tracking starts.
  useEffect(() => {
    if (!doc || !width || resumeTarget.current === null) return
    const page = clampReadingPage(resumeTarget.current, doc.numPages)
    resumeTarget.current = page
    latestPage.current = page
    setCurrentPage(page)
    if (initialPage !== undefined) void db.texts.update(text.id, { readingPage: page, updatedAt: Date.now() })
    columnRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`)?.scrollIntoView({ block: 'start' })
  }, [doc, width, initialPage, text.id])

  useEffect(() => {
    if (!doc || !width) return
    let timer: number | undefined
    const saveVisiblePage = (updateUi = true) => {
      if (resumeTarget.current !== null) return
      const visible = [...(columnRef.current?.querySelectorAll<HTMLElement>('[data-pdf-page]') ?? [])]
        .find((element) => element.getBoundingClientRect().bottom > 100)
      if (!visible) return
      const page = Number(visible.dataset.pdfPage)
      if (page === latestPage.current) return
      latestPage.current = page
      if (updateUi) setCurrentPage(page)
      void db.texts.update(text.id, { readingPage: page, updatedAt: Date.now() })
    }
    const onScroll = () => { window.clearTimeout(timer); timer = window.setTimeout(() => saveVisiblePage(), 150) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.clearTimeout(timer); window.removeEventListener('scroll', onScroll); saveVisiblePage(false) }
  }, [doc, width, text.id])

  const searchSource = useCallback(async (signal: AbortSignal) => {
    if (!doc) throw new Error('missing-pdf')
    let content = ''
    const locations: ReaderLocation[] = []
    for (let page = 0; page < doc.numPages; page++) {
      if (signal.aborted) throw new Error('cancelled')
      const pdfPage = await doc.getPage(page + 1)
      const text = await pdfPage.getTextContent()
      const body = text.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
      const start = content.length
      content += body + '\n\n'
      locations.push({ page, sentence: 0, start, end: content.length })
    }
    return { content, locations }
  }, [doc])

  function goToPage(page: number) {
    const target = clampReadingPage(page, doc?.numPages ?? text.pageCount ?? 1)
    setSelection(null)
    latestPage.current = target
    setCurrentPage(target)
    resumeTarget.current = layers.current.has(target + 1) ? null : target
    columnRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${target}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' })
    void db.texts.update(text.id, { readingPage: target, updatedAt: Date.now() })
  }

  // Color new and learning words on every rendered page.
  useEffect(() => {
    if (!supportsHighlights) return
    const fresh = new Highlight()
    const learning = new Highlight()
    const phrases = new Highlight()
    for (const index of layers.current.values()) {
      for (const word of index.words) {
        const status = wordMap.get(word.term)?.status
        if (status === 'known' || status === 'ignored') continue
        const range = rangeFor(index, word.start, word.end)
        if (range) (status === 'learning' ? learning : fresh).add(range)
      }
      for (const match of findTextPhrases(index.text, index.words, phraseIndex)) {
        const range = rangeFor(index, index.words[match.start].start, index.words[match.end].end)
        if (range) phrases.add(range)
      }
    }
    CSS.highlights.set(HIGHLIGHTS.new, fresh)
    CSS.highlights.set(HIGHLIGHTS.learning, learning)
    CSS.highlights.set(HIGHLIGHTS.phrase, phrases)
  }, [wordMap, pageTerms, phraseIndex])

  useEffect(() => {
    if (!supportsHighlights) return
    const index = selection ? layers.current.get(selection.page) : undefined
    const range = index && selection ? rangeFor(index, selection.start, selection.end) : undefined
    if (range) CSS.highlights.set(HIGHLIGHTS.selected, new Highlight(range))
    else CSS.highlights.delete(HIGHLIGHTS.selected)
  }, [selection, pageTerms])

  useEffect(
    () => () => {
      if (supportsHighlights) Object.values(HIGHLIGHTS).forEach((name) => CSS.highlights.delete(name))
    },
    [],
  )

  /** Selects one word, or a phrase of consecutive words, on a page. */
  function selectWords(page: number, index: PageTextIndex, words: PageWord[]) {
    const first = words[0]
    const last = words[words.length - 1]
    const term = phraseTerm(words.map((word) => word.term))
    const surface =
      words.length === 1
        ? first.surface
        : index.text
            .slice(first.start, last.end)
            .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
            .replace(/\s+/g, ' ')
            .trim()
    const sentence = sentenceAt(index, first.start, language)
    const status = wordMap.get(term)?.status
    setSelection({ page, start: first.start, end: last.end, term, surface, sentence, autoExplain: status !== 'known' && status !== 'ignored' })
    // Clicking an untracked word (or selecting a new phrase) means "I don't know this", like in the text reader.
    if (!status) void setWordStatus(language, term, 'learning', sentence)
  }

  /** Selecting several words in the text layer saves them as a phrase. */
  function selectPhraseFromSelection() {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed || !selected.rangeCount) return
    const range = selected.getRangeAt(0)
    const container = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const page = Number(container?.closest<HTMLElement>('.textLayer')?.dataset.page)
    const index = layers.current.get(page)
    const start = index && offsetOf(index, range.startContainer, range.startOffset)
    const end = index && offsetOf(index, range.endContainer, range.endOffset)
    if (!index || start === undefined || end === undefined) return
    let words = index.words.filter((word) => word.end > start && word.start < end)
    // Stay within the first sentence and a sensible length.
    const sentenceEnd = words.findIndex((word, i) => i > 0 && /[.!?。！？]|\n\n/.test(index.text.slice(words[i - 1].end, word.start)))
    if (sentenceEnd > 0) words = words.slice(0, sentenceEnd)
    words = words.slice(0, MAX_PHRASE_WORDS)
    if (words.length < 2) return
    selected.removeAllRanges()
    phraseJustSelected.current = true
    window.setTimeout(() => (phraseJustSelected.current = false))
    selectWords(page, index, words)
  }

  // On touch screens a selection is adjusted with handles, so wait until it settles.
  // Re-registered each render so the handler sees current state.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    let timer: number | undefined
    const onChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(selectPhraseFromSelection, 800)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  })

  function onPageClick(event: MouseEvent<HTMLDivElement>) {
    // Let people select text without it counting as a click on a word.
    if (phraseJustSelected.current || !window.getSelection()?.isCollapsed) return
    const layer = (event.target as HTMLElement).closest<HTMLElement>('.textLayer')
    const page = Number(layer?.dataset.page)
    const index = layers.current.get(page)
    const caret = caretAt(event.clientX, event.clientY)
    if (!index || !caret) return
    const offset = offsetOf(index, caret.node, caret.offset)
    if (offset === undefined) return
    // The caret can land just after a word's last letter.
    const word = wordAt(index, offset) ?? wordAt(index, offset - 1)
    if (!word) return
    // A word of a saved phrase opens the phrase.
    const position = index.words.indexOf(word)
    const phrase = findTextPhrases(index.text, index.words, phraseIndex).find(
      (match) => position >= match.start && position <= match.end,
    )
    selectWords(page, index, phrase ? index.words.slice(phrase.start, phrase.end + 1) : [word])
  }

  function changeStatus(status: WordStatus) {
    if (selection) void setWordStatus(language, selection.term, status, selection.sentence)
  }

  useWordShortcuts({ onStatus: selection ? changeStatus : undefined, onClose: () => setSelection(null) })

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <article className={`w-full min-w-0 ${selection ? 'pb-[60dvh] lg:pb-0' : ''}`}>
        <div className="mx-auto max-w-[53.75rem]">
          <a href="#/" className={`${ui.ghostButton} -ml-2 mb-3`}>
            ← {t('reader.back')}
          </a>
          <h1 className="font-reading text-3xl leading-tight font-semibold text-stone-900 sm:text-4xl dark:text-stone-50">
            {text.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <StatusLegend />
            <ReadingsToggle language={language} state={readings} />
          </div>
          <ReaderTools text={text} page={currentPage} totalPages={doc?.numPages ?? text.pageCount ?? 1} onNavigate={goToPage} searchSource={doc ? searchSource : undefined} />
          <a href={`#/quiz/${language}?text=${text.id}`} className={`${ui.secondaryButton} mt-3`}>{t('textQuiz.scope', { title: text.title })}</a>
          <p className="mt-2 hidden text-xs text-stone-400 sm:block">{t('reader.pdfHint')}</p>
        </div>

        <div ref={columnRef} onClick={onPageClick} onMouseUp={selectPhraseFromSelection} lang={language} className="mx-auto mt-6 flex max-w-[53.75rem] flex-col items-center gap-4">
          {failed || file === null ? <p className={ui.muted}>{t('reader.pdfError')}</p> : null}
          {!doc && !failed && file !== null ? <p className={ui.muted}>{t('reader.pdfLoading')}</p> : null}
          {doc && width > 0
            ? Array.from({ length: doc.numPages }, (_, i) => (
                <Fragment key={i + 1}>
                  <PdfPage doc={doc} pageNumber={i + 1} width={width} onTextLayer={onTextLayer} />
                  <FinishPage
                    language={language}
                    pageNumber={i + 1}
                    onFinish={async () => {
                      await recordPageRead(text.id, i, pageWordCounts.get(i + 1) ?? 0)
                      await db.texts.update(text.id, { readingPage: i, updatedAt: Date.now() })
                    }}
                    untracked={(pageTerms.get(i + 1) ?? []).filter((term) => !wordMap.has(term))}
                    rendered={pageTerms.has(i + 1)}
                  />
                </Fragment>
              ))
            : null}
        </div>
      </article>

      <WordAside open={selection !== null}>
        {selection ? (
          <WordPanel
            key={`${selection.page}:${selection.start}:${selection.term}`}
            autoExplain={selection.autoExplain}
            language={language}
            term={selection.term}
            surface={selection.surface}
            sentence={selection.sentence}
            entry={wordMap.get(selection.term)}
            source={{ id: text.syncId ?? '', title: text.title, url: text.sourceUrl, page: selection.page - 1 }}
            reading={readings.status === 'ready' ? readings.annotator.reading(selection.surface) : undefined}
            onStatus={changeStatus}
            onClose={() => setSelection(null)}
          />
        ) : null}
      </WordAside>
    </div>
  )
}

interface PdfPageProps {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  onTextLayer: (page: number, layer: HTMLElement | null) => void
}

/** One page: drawn on a canvas, with pdf.js's invisible text layer on top for picking words. */
function PdfPage({ doc, pageNumber, width, onTextLayer }: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  // Height/width ratio; A4 until the real page size is known.
  const [aspect, setAspect] = useState(1.414)

  // Keep only nearby pages drawn; distant pages retain their dimensions, not their canvas.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '150% 0px' },
    )
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!visible || !wrapper) return
    let cancelled = false
    let renderTask: RenderTask | undefined
    let textLayer: TextLayer | undefined
    let canvas: HTMLCanvasElement | undefined
    let page: PDFPageProxy | undefined

    void (async () => {
      const pdfjs = await loadPdfjs()
      page = await doc.getPage(pageNumber)
      if (cancelled) return
      const scale = width / page.getViewport({ scale: 1 }).width
      const viewport = page.getViewport({ scale })
      setAspect(viewport.height / viewport.width)
      // pdf.js sizes the text layer from these CSS variables.
      wrapper.style.setProperty('--scale-factor', String(scale))
      wrapper.style.setProperty('--user-unit', String(viewport.userUnit || 1))

      const pixelRatio = window.devicePixelRatio || 1
      canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * pixelRatio)
      canvas.height = Math.floor(viewport.height * pixelRatio)
      const layer = document.createElement('div')
      layer.className = 'textLayer'
      layer.dataset.page = String(pageNumber)
      wrapper.replaceChildren(canvas, layer)

      renderTask = page.render({
        canvas,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      })
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
      await Promise.all([renderTask.promise, textLayer.render()])
      if (!cancelled) onTextLayer(pageNumber, layer)
    })().catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) console.warn(error)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      onTextLayer(pageNumber, null)
      wrapper.replaceChildren()
      if (canvas) canvas.width = canvas.height = 0
      // Wait for cancellation to settle before releasing pdf.js's page resources.
      if (renderTask) void renderTask.promise.catch(() => {}).then(() => page?.cleanup())
      else page?.cleanup()
    }
  }, [doc, pageNumber, width, visible, onTextLayer])

  return <div ref={wrapperRef} data-pdf-page={pageNumber - 1} className="pdf-page scroll-mt-24" style={{ width, height: Math.round(width * aspect) }} />
}

/** Below each page: mark the page's remaining new words as known (LingQ's "page turn"). */
function FinishPage({
  language,
  pageNumber,
  untracked,
  rendered,
  onFinish,
}: {
  language: string
  pageNumber: number
  untracked: string[]
  rendered: boolean
  onFinish: () => Promise<void>
}) {
  const t = useT()
  const [finished, setFinished] = useState(false)
  const [finishing, setFinishing] = useState(false)
  // Preserve the footer's height when its page is unloaded, to avoid scroll jumps.
  if (!rendered) return <div className="min-h-9 w-full" />
  return (
    <div className="flex min-h-9 w-full justify-end">
      {!finished || untracked.length > 0 ? (
        <button
          type="button"
          disabled={finishing}
          onClick={async () => {
            setFinishing(true)
            try {
              await markUntrackedAsKnown(language, untracked)
              await onFinish()
              setFinished(true)
            } finally {
              setFinishing(false)
            }
          }}
          className={ui.ghostButton}
        >
          ✓ {untracked.length ? t('reader.finishPdfPage', { page: pageNumber, n: untracked.length }) : t('reader.recordPage')}
        </button>
      ) : (
        <span className="px-2 py-1 text-sm text-emerald-700 dark:text-emerald-400">✓ {t('reader.pdfPageDone', { page: pageNumber })}</span>
      )}
    </div>
  )
}
