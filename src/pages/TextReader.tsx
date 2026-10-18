import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ReadingsToggle, StatusLegend, WordAside } from '../components/ReaderParts'
import { SimplifyPanel } from '../components/SimplifyPanel'
import { STATUS_CLASS } from '../components/statusStyles'
import { ui } from '../components/ui'
import { WordPanel } from '../components/WordPanel'
import { db, markUntrackedAsKnown, recordPageRead, setWordStatus, type TextDoc, type WordEntry, type WordStatus } from '../lib/db'
import { isTypingTarget, useWordMap, useWordShortcuts } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { textDirection } from '../lib/languages'
import { buildPhraseIndex, findTextPhrases, MAX_PHRASE_WORDS, phraseTerm, type PhraseMatch } from '../lib/phrases'
import type { Annotation } from '../lib/readings'
import { canSpeak, readAloud } from '../lib/speech'
import { useReadings } from '../lib/useReadings'
import { paginate, tokenize, uniqueTerms, wordPositions, wordTokenAt, type Sentence } from '../lib/tokenize'

const READING_RATES = [0.7, 0.9, 1.1]

/** A word's text with ruby readings over the parts that have one (furigana, pinyin). */
function withReadings(text: string, start: number, annotations: Annotation[] | undefined): ReactNode {
  if (!annotations?.length) return text
  const end = start + text.length
  const parts: ReactNode[] = []
  let position = start
  for (const annotation of annotations) {
    // Only readings that fall entirely inside this word.
    if (annotation.start < position || annotation.end > end) continue
    if (annotation.start > position) parts.push(text.slice(position - start, annotation.start - start))
    parts.push(
      <ruby key={annotation.start}>
        {text.slice(annotation.start - start, annotation.end - start)}
        <rt>{annotation.reading}</rt>
      </ruby>,
    )
    position = annotation.end
  }
  if (!parts.length) return text
  if (position < end) parts.push(text.slice(position - start))
  return parts
}

/** Saved phrases being learned are underlined across their words. */
const PHRASE_CLASS =
  'underline decoration-amber-400 decoration-[3px] underline-offset-[7px] [text-decoration-skip-ink:none] dark:decoration-amber-500'

function wordClass(entry: WordEntry | undefined, selected: boolean): string {
  return [
    'cursor-pointer rounded-[4px] px-px -mx-px transition-colors hover:underline hover:decoration-indigo-400 hover:decoration-2 hover:underline-offset-4',
    STATUS_CLASS[entry?.status ?? 'new'],
    selected ? 'outline-2 outline-offset-1 outline-indigo-500' : '',
  ].join(' ')
}

/** Reader for pasted texts: every word is a clickable, colored token. Long texts are split into pages. */
export function TextReader({ text }: { text: TextDoc }) {
  const t = useT()
  const { language, content } = text
  const wordMap = useWordMap(language)
  const articleRef = useRef<HTMLElement>(null)

  const paragraphs = useMemo(() => (content && language ? tokenize(content, language) : []), [content, language])
  const pages = useMemo(() => paginate(paragraphs), [paragraphs])
  const [page, setPage] = useState(() => Math.min(Math.max(text.readingPage ?? 0, 0), Math.max(pages.length - 1, 0)))
  const pageParagraphs = useMemo(() => pages[page] ?? [], [pages, page])
  const positions = useMemo(() => wordPositions(pageParagraphs), [pageParagraphs])
  const terms = useMemo(() => uniqueTerms(paragraphs), [paragraphs])
  const pageTerms = useMemo(() => uniqueTerms(pageParagraphs), [pageParagraphs])
  // A word, or a phrase from word `index` to word `end` (inclusive) in one sentence.
  const [selected, setSelected] = useState<{ index: number; end: number; autoExplain: boolean } | null>(null)
  const [simplifying, setSimplifying] = useState(false)
  const [finishedPages, setFinishedPages] = useState<ReadonlySet<number>>(new Set())
  const [finishing, setFinishing] = useState(false)
  const regionRef = useRef<HTMLDivElement>(null)

  const phraseIndex = useMemo(
    () => buildPhraseIndex([...wordMap.values()].filter((word) => word.status === 'learning').map((word) => word.term)),
    [wordMap],
  )
  // Word index on the page → the saved phrase it belongs to.
  const phraseAt = useMemo(() => {
    const map = new Map<number, PhraseMatch>()
    let offset = 0
    for (const paragraph of pageParagraphs) {
      for (const sentence of paragraph.sentences) {
        let charOffset = 0
        const words: { term: string; start: number; end: number }[] = []
        for (const token of sentence.tokens) {
          if (token.kind === 'word') words.push({ term: token.term, start: charOffset, end: charOffset + token.text.length })
          charOffset += token.text.length
        }
        for (const match of findTextPhrases(sentence.tokens.map((token) => token.text).join(''), words, phraseIndex)) {
          const onPage = { start: offset + match.start, end: offset + match.end, term: match.term }
          for (let i = onPage.start; i <= onPage.end; i++) map.set(i, onPage)
        }
        offset += words.length
      }
    }
    return map
  }, [pageParagraphs, phraseIndex])

  const selectedItem = selected ? itemAt(selected.index, selected.end) : undefined
  const rtl = textDirection(language) === 'rtl'

  // Read aloud: the page's sentences in order, with the sentence and word being spoken.
  const pageSentences = useMemo(() => pageParagraphs.flatMap((paragraph) => paragraph.sentences), [pageParagraphs])
  const [reading, setReading] = useState<{ sentence: number; word: number | null; playing: boolean } | null>(null)
  const [rate, setRate] = useState(READING_RATES[1])
  const stopReading = useRef<(() => void) | null>(null)
  useEffect(() => () => stopReading.current?.(), [])

  // Furigana / pinyin for each sentence of the page.
  const readings = useReadings(language)
  const pageAnnotations = useMemo(
    () => (readings.status === 'ready' ? pageSentences.map((sentence) => readings.annotator.annotate(sentence.text)) : null),
    [readings, pageSentences],
  )

  const stats = useMemo(() => {
    const counts = { new: 0, learning: 0, known: 0 }
    for (const term of terms) {
      const status = wordMap.get(term)?.status
      if (!status) counts.new++
      else if (status === 'learning') counts.learning++
      else counts.known++
    }
    return counts
  }, [terms, wordMap])

  /** The word or phrase from word `start` to word `end`, which must be in the same sentence. */
  function itemAt(start: number, end: number): { sentence: Sentence; term: string; surface: string; words: number[] } {
    const first = positions[start]
    const sentence = pageParagraphs[first.paragraph].sentences[first.sentence]
    const tokens = sentence.tokens.slice(first.token, positions[end].token + 1)
    const terms = tokens.flatMap((token) => (token.kind === 'word' ? [token.term] : []))
    return {
      sentence,
      term: phraseTerm(terms),
      surface: tokens.map((token) => token.text).join('').trim(),
      words: Array.from({ length: end - start + 1 }, (_, i) => start + i),
    }
  }

  function sameSentence(a: number, b: number): boolean {
    return positions[a].paragraph === positions[b].paragraph && positions[a].sentence === positions[b].sentence
  }

  /** Clicking a word of a saved phrase opens the phrase. */
  function select(index: number, fromClick: boolean) {
    const phrase = fromClick ? phraseAt.get(index) : undefined
    selectRange(phrase?.start ?? index, phrase?.end ?? index, fromClick)
  }

  function selectRange(start: number, end: number, fromClick: boolean) {
    const { term, sentence } = itemAt(start, end)
    const status = wordMap.get(term)?.status
    // Only a click asks for an explanation; stepping with the arrow keys or landing on a
    // known word shows a cached one or an "Explain" button, so no API calls are spent.
    setSelected({ index: start, end, autoExplain: fromClick && status !== 'known' && status !== 'ignored' })
    // Clicking an untracked word (or selecting a new phrase) means "I don't know this", like LingQ's blue words.
    if (fromClick && term && !status) void setWordStatus(language, term, 'learning', sentence.text)
  }

  function changeStatus(status: WordStatus) {
    if (!selectedItem) return
    void setWordStatus(language, selectedItem.term, status, selectedItem.sentence.text)
  }

  /** Dragging across words (or adjusting a selection on a phone) saves them as a phrase. */
  function selectPhraseFromSelection() {
    const selection = window.getSelection()
    const region = regionRef.current
    if (!selection || selection.isCollapsed || !region || !region.contains(selection.anchorNode)) return
    const indices = Array.from(region.querySelectorAll<HTMLElement>('[data-word]'))
      .filter((span) => selection.containsNode(span, true))
      .map((span) => Number(span.dataset.word))
    if (indices.length < 2) return
    // Stay within the sentence where the selection starts, and within a sensible length.
    const inSentence = indices.filter((index) => sameSentence(indices[0], index)).slice(0, MAX_PHRASE_WORDS)
    selection.removeAllRanges()
    if (inSentence.length < 2) return select(inSentence[0], true)
    selectRange(inSentence[0], inSentence[inSentence.length - 1], true)
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

  /** Index of a word's sentence among the page's sentences. */
  function sentenceOf(index: number): number {
    const { paragraph, sentence } = positions[index]
    return pageParagraphs.slice(0, paragraph).reduce((count, p) => count + p.sentences.length, 0) + sentence
  }

  function startReading(from: number, speed = rate) {
    stopReading.current?.()
    setReading({ sentence: from, word: null, playing: true })
    stopReading.current = readAloud(
      pageSentences.map((sentence) => sentence.text),
      language,
      from,
      speed,
      {
        onSentence: (index) => setReading({ sentence: index, word: null, playing: true }),
        onWord: (index, charIndex) => setReading({ sentence: index, word: wordTokenAt(pageSentences[index], charIndex) ?? null, playing: true }),
        onDone: (finished) => {
          stopReading.current = null
          setReading((current) => (finished || !current ? null : { ...current, word: null, playing: false }))
        },
      },
    )
  }

  function pauseReading() {
    stopReading.current?.()
    stopReading.current = null
    setReading((current) => current && { ...current, word: null, playing: false })
  }

  /** Starts at the selected word's sentence, or where it was paused, or the top of the page. */
  function toggleReading() {
    if (reading?.playing) return pauseReading()
    startReading(selected ? sentenceOf(selected.index) : (reading?.sentence ?? 0))
  }

  function changeRate() {
    const next = READING_RATES[(READING_RATES.indexOf(rate) + 1) % READING_RATES.length]
    setRate(next)
    if (reading?.playing) startReading(reading.sentence, next)
  }

  // P plays or pauses. Re-registered each render so it sees current state.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'p' || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (canSpeak()) toggleReading()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const readingSentence = reading?.sentence ?? null
  useEffect(() => {
    if (readingSentence === null) return
    document.querySelector(`[data-sentence="${readingSentence}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [readingSentence])

  function goToPage(next: number) {
    if (next < 0 || next >= pages.length) return
    stopReading.current?.()
    stopReading.current = null
    setReading(null)
    setSelected(null)
    setPage(next)
    void db.texts.update(text.id, { readingPage: next })
    articleRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function onTextClick(event: MouseEvent<HTMLDivElement>) {
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-word]')
    if (element) select(Number(element.dataset.word), true)
  }

  useWordShortcuts({
    onStatus: selected ? changeStatus : undefined,
    onClose: () => setSelected(null),
    // In right-to-left text the arrow keys follow what's on screen: → goes back.
    onMove: positions.length
      ? (key) => {
          const step = rtl ? -key : key
          const next = selected === null ? (step > 0 ? 0 : positions.length - 1) : step > 0 ? selected.end + 1 : selected.index - 1
          if (next >= 0 && next < positions.length) select(next, false)
        }
      : undefined,
    // Shift+→ adds the next word to the selection, Shift+← takes the last one off.
    onExtend: selected
      ? (key) => {
          const step = rtl ? -key : key
          const end = selected.end + step
          if (end < selected.index || end >= positions.length || end - selected.index >= MAX_PHRASE_WORDS) return
          if (sameSentence(selected.index, end)) selectRange(selected.index, end, false)
        }
      : undefined,
  })

  const selectedIndex = selected?.index ?? null
  const isSelected = (index: number) => selected !== null && index >= selected.index && index <= selected.end

  /** A sentence's tokens, with the words of each saved phrase wrapped together. */
  function renderSentence(sentence: Sentence, ordinal: number): ReactNode {
    const spoken = reading?.sentence === ordinal ? reading.word : null
    const annotations = pageAnnotations?.[ordinal]
    // Character range of each token in the sentence's (trimmed) text.
    const full = sentence.tokens.map((token) => token.text).join('')
    let offset = -(full.length - full.trimStart().length)
    const ranges = sentence.tokens.map((token) => [offset, (offset += token.text.length)] as const)

    const wordIndexes: number[] = []
    const nodes = sentence.tokens.map((token, k) => {
      if (token.kind === 'text') {
        wordIndexes.push(-1)
        return <Fragment key={k}>{token.text}</Fragment>
      }
      const index = wordIndex++
      wordIndexes.push(index)
      return (
        <span
          key={k}
          role="button"
          data-word={index}
          aria-pressed={isSelected(index)}
          className={`${wordClass(wordMap.get(token.term), isSelected(index))} ${
            spoken === k ? 'shadow-[inset_0_-0.2em_0_var(--color-indigo-500)]' : ''
          }`}
        >
          {withReadings(token.text, ranges[k][0], annotations)}
        </span>
      )
    })

    // Groups of tokens wrapped together: saved phrases (underlined) and readings that cover
    // several words, e.g. 番人 (ばんにん) when the browser splits it into 番 and 人.
    type Group = { start: number; end: number; wrap: (children: ReactNode[], key: string) => ReactNode }
    const candidates: Group[] = []
    wordIndexes.forEach((index, k) => {
      const match = index >= 0 ? phraseAt.get(index) : undefined
      if (match?.start !== index) return
      const end = wordIndexes.indexOf(match.end, k)
      candidates.push({ start: k, end, wrap: (children, key) => <span key={key} className={PHRASE_CLASS}>{children}</span> })
    })
    for (const annotation of annotations ?? []) {
      const first = ranges.findIndex(([from]) => from === annotation.start)
      const last = ranges.findIndex(([, to]) => to === annotation.end)
      if (first < 0 || last <= first) continue
      candidates.push({
        start: first,
        end: last,
        wrap: (children, key) => (
          <ruby key={key}>
            {children}
            <rt>{annotation.reading}</rt>
          </ruby>
        ),
      })
    }
    // Keep groups that nest; drop any that would cross one already kept.
    const groups: Group[] = []
    for (const group of candidates.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const crosses = groups.some((kept) => group.start <= kept.end && group.end > kept.end && group.start > kept.start)
      if (!crosses) groups.push(group)
    }

    const stack: { group?: Group; children: ReactNode[] }[] = [{ children: [] }]
    nodes.forEach((node, k) => {
      for (const group of groups.filter((candidate) => candidate.start === k)) stack.push({ group, children: [] })
      stack[stack.length - 1].children.push(node)
      while (stack.length > 1 && stack[stack.length - 1].group!.end === k) {
        const { group, children } = stack.pop()!
        stack[stack.length - 1].children.push(group!.wrap(children, `group-${group!.start}-${k}`))
      }
    })

    return (
      <span
        data-sentence={ordinal}
        className={reading?.sentence === ordinal ? 'rounded bg-indigo-50 box-decoration-clone dark:bg-indigo-500/10' : undefined}
      >
        {stack[0].children}
      </span>
    )
  }
  useEffect(() => {
    if (selectedIndex === null) return
    document.querySelector(`[data-word="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  let wordIndex = 0
  let sentenceOrdinal = 0
  const multiPage = pages.length > 1
  const lastPage = page === pages.length - 1
  const untracked = pageTerms.filter((term) => !wordMap.has(term))

  async function finish() {
    setFinishing(true)
    try {
      await markUntrackedAsKnown(language, untracked)
      await recordPageRead(text.id, page, positions.length)
      setFinishedPages((current) => new Set(current).add(page))
      if (!lastPage) goToPage(page + 1)
    } finally {
      setFinishing(false)
    }
  }

  function nextPage() {
    void recordPageRead(text.id, page, positions.length)
    goToPage(page + 1)
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <article ref={articleRef} className={`mx-auto w-full max-w-[42rem] scroll-mt-20 ${selectedItem ? 'pb-[60dvh] lg:pb-0' : ''}`}>
        <a href="#/" className={`${ui.ghostButton} -ml-2 mb-3`}>
          ← {t('reader.back')}
        </a>
        <h1 dir="auto" className="font-reading text-3xl leading-tight font-semibold text-stone-900 sm:text-4xl dark:text-stone-50">
          {text.title}
        </h1>
        <SourceLink url={text.sourceUrl} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <StatusLegend stats={stats} />
          <div className="flex items-center gap-3">
            <ReadingsToggle language={language} state={readings} />
            {canSpeak() ? (
              <span className="flex items-center">
                <button type="button" onClick={toggleReading} aria-pressed={reading?.playing ?? false} className={ui.ghostButton}>
                  <span aria-hidden="true">{reading?.playing ? '❚❚' : '▶'}</span> {t(reading?.playing ? 'reader.pause' : 'reader.listen')}
                </button>
                <button
                  type="button"
                  onClick={changeRate}
                  aria-label={t('reader.speed')}
                  title={t('reader.speed')}
                  className={`${ui.ghostButton} tabular-nums`}
                >
                  {rate}×
                </button>
              </span>
            ) : null}
            {multiPage ? (
              <span className="text-sm text-stone-500 tabular-nums dark:text-stone-400">
                {t('reader.page', { n: page + 1, total: pages.length })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setSimplifying((open) => !open)}
              aria-expanded={simplifying}
              className={`${ui.ghostButton} -mr-2`}
            >
              {t('simplify.button')}
            </button>
          </div>
        </div>
        {simplifying ? (
          <SimplifyPanel
            text={text}
            pageText={pageParagraphs.map((paragraph) => paragraph.sentences.map((sentence) => sentence.text).join(' ')).join('\n\n')}
            multiPage={multiPage}
            onClose={() => setSimplifying(false)}
          />
        ) : null}
        <p className="mt-2 hidden text-xs text-stone-400 sm:block">{t('reader.hint')}</p>

        <div
          ref={regionRef}
          onClick={onTextClick}
          onMouseUp={selectPhraseFromSelection}
          lang={language}
          dir={textDirection(language)}
          role="region"
          tabIndex={0}
          aria-label={t('reader.textArea')}
          className="font-reading mt-8 rounded-lg text-[1.2rem] leading-[1.95] text-stone-800 outline-offset-8 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-stone-200"
        >
          {pageParagraphs.map((paragraph, p) => (
            <p key={`${page}:${p}`} className="mb-6">
              {paragraph.sentences.map((sentence, s) => (
                <Fragment key={s}>{renderSentence(sentence, sentenceOrdinal++)}</Fragment>
              ))}
            </p>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-4 border-t border-stone-200 pt-6 dark:border-stone-800">
          {!finishedPages.has(page) || untracked.length > 0 ? (
            <button type="button" disabled={finishing} onClick={() => void finish()} className={`${ui.secondaryButton} self-start`}>
              ✓{' '}
              {untracked.length === 0
                ? t('reader.recordPage')
                : multiPage && !lastPage
                  ? t('reader.finishPage', { n: untracked.length })
                  : t('reader.finish', { n: untracked.length })}
            </button>
          ) : lastPage ? (
            <p className={ui.muted}>{t('reader.finishDone')}</p>
          ) : null}

          {multiPage ? (
            <nav className="flex items-center justify-between gap-2" aria-label={t('reader.pages')}>
              <button type="button" onClick={() => goToPage(page - 1)} disabled={page === 0} className={ui.secondaryButton}>
                ← {t('reader.prevPage')}
              </button>
              <span className="text-sm text-stone-500 tabular-nums dark:text-stone-400">
                {t('reader.page', { n: page + 1, total: pages.length })}
              </span>
              <button type="button" onClick={nextPage} disabled={lastPage} className={ui.secondaryButton}>
                {t('reader.nextPage')} →
              </button>
            </nav>
          ) : null}
        </div>
      </article>

      <WordAside open={Boolean(selectedItem)}>
        {selected && selectedItem ? (
          <WordPanel
            key={`${page}:${selected.index}:${selectedItem.term}`}
            autoExplain={selected.autoExplain}
            language={language}
            term={selectedItem.term}
            surface={selectedItem.surface}
            sentence={selectedItem.sentence.text}
            entry={wordMap.get(selectedItem.term)}
            reading={readings.status === 'ready' ? readings.annotator.reading(selectedItem.surface) : undefined}
            parts={
              selectedItem.words.length > 1
                ? selectedItem.words.map((index) => ({ label: itemAt(index, index).surface, onSelect: () => selectRange(index, index, false) }))
                : undefined
            }
            onStatus={changeStatus}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </WordAside>
    </div>
  )
}

function SourceLink({ url }: { url?: string }) {
  const t = useT()
  let host = ''
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    // Not a valid URL; show nothing.
  }
  if (!url || !host) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-stone-500 underline-offset-2 hover:underline dark:text-stone-400">
      {t('reader.source', { host })}
    </a>
  )
}
