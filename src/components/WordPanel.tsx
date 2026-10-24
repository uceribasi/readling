import { useEffect, useState } from 'react'
import { explainWord, getCachedExplanation, getCachedTranslation, isAiConfigured, translateSentence, type Explanation } from '../lib/ai'
import { rememberContext, saveExplanation, type WordEntry, type WordStatus, type WordSource } from '../lib/db'
import { WordMemory } from './WordMemory'
import { errorMessage } from '../lib/errors'
import { useT, type MessageKey, type Translate } from '../lib/i18n'
import { activeModel, getSettings, useSettings } from '../lib/settings'
import { isTypingTarget } from '../lib/hooks'
import { isPhrase } from '../lib/phrases'
import { speak } from '../lib/speech'
import { HighlightedSentence } from './HighlightedSentence'
import { SpeakButton } from './SpeakButton'
import { ui } from './ui'

interface WordPanelProps {
  language: string
  term: string
  surface: string
  sentence: string
  entry?: WordEntry
  source?: WordSource
  /** Fetch an explanation without being asked. Off for words the learner already knows. */
  autoExplain: boolean
  /** Furigana or pinyin for the word, when readings are on. */
  reading?: string
  /** For a phrase: its words, to look one of them up on its own. */
  parts?: { label: string; onSelect: () => void }[]
  onStatus: (status: WordStatus) => void
  onClose: () => void
}

type ExplainState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: Explanation }
  | { status: 'error'; message: string }

const STATUS_BUTTONS: { status: WordStatus; label: MessageKey; shortcut: string; active: string }[] = [
  { status: 'learning', label: 'panel.learning', shortcut: '1', active: 'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-500/20 dark:text-amber-100' },
  { status: 'known', label: 'panel.known', shortcut: 'K', active: 'border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-100' },
  { status: 'ignored', label: 'panel.ignore', shortcut: 'X', active: 'border-stone-400 bg-stone-200 text-stone-800 dark:border-stone-500 dark:bg-stone-700 dark:text-stone-100' },
]

/** Render with a `key` per selected word so its state starts fresh for each word. */
export function WordPanel({ language, term, surface, sentence, entry, source, autoExplain, reading, parts, onStatus, onClose }: WordPanelProps) {
  const t = useT()
  const settings = useSettings()
  const configured = isAiConfigured(settings)
  // Start in "loading" when we'll explain on our own, so the "Explain" button doesn't flash first.
  const [state, setState] = useState<ExplainState>(() =>
    autoExplain && configured ? { status: 'loading' } : { status: 'idle' },
  )
  const [manualRequest, setManualRequest] = useState(0)
  const [translationRequest, setTranslationRequest] = useState(0)
  const canTranslate = configured && language !== settings.explanationLanguage

  const { explanationLanguage, provider } = settings
  const model = activeModel(settings)
  const sourceId = source?.id
  const sourceTitle = source?.title
  const sourceUrl = source?.url
  const sourcePage = source?.page

  useEffect(() => {
    if (entry?.key) void rememberContext(language, term, sentence, sourceId ? { id: sourceId, title: sourceTitle ?? '', url: sourceUrl, page: sourcePage } : undefined)
  }, [entry?.key, language, term, sentence, sourceId, sourceTitle, sourceUrl, sourcePage])

  useEffect(() => {
    const request = { term, surface, sentence, language, explanationLanguage }
    const controller = new AbortController()
    let cancelled = false

    const timer = window.setTimeout(async () => {
      const cached = await getCachedExplanation(request)
      if (cancelled) return
      if (cached) {
        setState({ status: 'done', data: cached })
        await saveExplanation(language, term, cached, sentence, sourceId ? { id: sourceId, title: sourceTitle ?? '', url: sourceUrl, page: sourcePage } : undefined)
        return
      }
      if (!configured || (!autoExplain && manualRequest === 0)) return
      setState({ status: 'loading' })
      try {
        const data = await explainWord(request, getSettings(), controller.signal)
        if (cancelled) return
        setState({ status: 'done', data })
        await saveExplanation(language, term, data, sentence, sourceId ? { id: sourceId, title: sourceTitle ?? '', url: sourceUrl, page: sourcePage } : undefined)
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error, t) })
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
    // getSettings() sends the latest settings; the listed fields decide when to refetch.
  }, [term, surface, sentence, language, explanationLanguage, provider, model, configured, autoExplain, manualRequest, t, sourceId, sourceTitle, sourceUrl, sourcePage])

  // S reads the word aloud, E asks the AI to explain it (useful after moving with the arrow keys), T translates the sentence.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 's') speak(surface, language)
      else if (key === 'e' && configured && state.status !== 'done' && state.status !== 'loading') setManualRequest((count) => count + 1)
      else if (key === 't' && canTranslate) setTranslationRequest((count) => count + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {isPhrase(term) ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">{t('panel.phrase')}</p>
          ) : null}
          <p className="flex items-center gap-1">
            <span lang={language} dir="auto" className="font-reading text-3xl leading-tight text-stone-900 dark:text-stone-50">
              {surface}
            </span>
            <SpeakButton text={surface} language={language} />
          </p>
          {reading && reading !== surface ? <p className="text-sm text-stone-500 dark:text-stone-400">{reading}</p> : null}
          {state.status === 'done' && (state.data.lemma || state.data.partOfSpeech) ? (
            <p className={ui.muted}>
              {[state.data.lemma !== surface ? state.data.lemma : '', state.data.partOfSpeech].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} className={ui.ghostButton} aria-label={t('panel.close')}>
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      </div>

      {parts ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-stone-500 dark:text-stone-400">{t('panel.phraseWords')}</span>
          {parts.map((part, i) => (
            <button
              key={i}
              type="button"
              onClick={part.onSelect}
              lang={language} dir="auto"
              className="rounded-md border border-stone-200 px-2 py-0.5 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {part.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {STATUS_BUTTONS.map((button) => (
          <button
            key={button.status}
            type="button"
            onClick={() => onStatus(button.status)}
            aria-pressed={entry?.status === button.status}
            className={`flex flex-col items-center rounded-lg border px-2 py-1.5 text-sm font-medium transition ${
              entry?.status === button.status
                ? button.active
                : 'border-stone-200 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
            }`}
          >
            {t(button.label)}
            <kbd className="text-[10px] font-normal opacity-60">{button.shortcut}</kbd>
          </button>
        ))}
      </div>

      <ExplanationView
        state={state}
        configured={configured}
        onRequest={() => setManualRequest((count) => count + 1)}
        t={t}
      />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{t('panel.context')}</p>
          <SpeakButton text={sentence} language={language} slow className="-my-1" />
        </div>
        <p lang={language} dir="auto" className="font-reading text-stone-700 dark:text-stone-300">
          <HighlightedSentence sentence={sentence} surface={surface} />
        </p>
        {canTranslate ? (
          <SentenceTranslation
            sentence={sentence}
            language={language}
            requested={translationRequest}
            onRequest={() => setTranslationRequest((count) => count + 1)}
          />
        ) : null}
      </div>
      {entry ? <WordMemory language={language} term={term} /> : null}
    </div>
  )
}

type TranslationState = { status: 'idle' | 'loading' } | { status: 'done'; text: string } | { status: 'error'; message: string }

/** The whole sentence in the learner's language, on request (or right away if it was translated before). */
function SentenceTranslation({
  sentence,
  language,
  requested,
  onRequest,
}: {
  sentence: string
  language: string
  requested: number
  onRequest: () => void
}) {
  const t = useT()
  const target = useSettings().explanationLanguage
  const [state, setState] = useState<TranslationState>({ status: 'idle' })

  useEffect(() => {
    const request = { sentence, language, target }
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      const cached = await getCachedTranslation(request)
      if (cancelled) return
      if (cached) return setState({ status: 'done', text: cached })
      if (!requested) return
      setState({ status: 'loading' })
      try {
        const text = await translateSentence(request, getSettings(), controller.signal)
        if (!cancelled) setState({ status: 'done', text })
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error, t) })
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [sentence, language, target, requested, t])

  if (state.status === 'done')
    return (
      <p dir="auto" className="mt-1.5 text-sm text-stone-500 italic dark:text-stone-400">
        {state.text}
      </p>
    )
  if (state.status === 'loading')
    return (
      <p className="mt-1.5 text-sm text-stone-500" role="status">
        {t('panel.translating')}
      </p>
    )
  return (
    <div className="mt-1">
      {state.status === 'error' ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {state.message}
        </p>
      ) : null}
      <button type="button" onClick={onRequest} className={`${ui.ghostButton} -ml-2`}>
        {t('panel.translateSentence')} <kbd className="text-[10px] opacity-60">T</kbd>
      </button>
    </div>
  )
}

function ExplanationView({
  state,
  configured,
  onRequest,
  t,
}: {
  state: ExplainState
  configured: boolean
  onRequest: () => void
  t: Translate
}) {
  if (state.status === 'done') {
    const { translation, meaning, grammar, example, exampleTranslation } = state.data
    return (
      <div dir="auto" className="flex flex-col gap-3">
        <p className="text-xl font-semibold text-indigo-700 dark:text-indigo-300">{translation}</p>
        {meaning ? <p className="text-stone-700 dark:text-stone-300">{meaning}</p> : null}
        {grammar ? (
          <div>
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-stone-400">{t('panel.grammar')}</p>
            <p className="text-sm text-stone-600 dark:text-stone-400">{grammar}</p>
          </div>
        ) : null}
        {example ? (
          <div>
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-stone-400">{t('panel.example')}</p>
            <p dir="auto" className="font-reading text-stone-800 dark:text-stone-200">{example}</p>
            {exampleTranslation ? <p className="text-sm text-stone-500 italic">{exampleTranslation}</p> : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200">
        <p>{t('panel.noKey')}</p>
        <a href="#/settings" className="mt-2 inline-block font-medium underline underline-offset-2">
          {t('panel.openSettings')}
        </a>
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500" role="status">
        <span className="size-3 animate-pulse rounded-full bg-indigo-500" />
        {t('panel.loading')}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200" role="alert">
        <p>{state.message}</p>
        <button type="button" onClick={onRequest} className="mt-2 font-medium underline underline-offset-2">
          {t('panel.retry')}
        </button>
      </div>
    )
  }

  return (
    <button type="button" onClick={onRequest} className={ui.secondaryButton}>
      {t('panel.explain')} <kbd className="text-xs font-normal opacity-60">E</kbd>
    </button>
  )
}
