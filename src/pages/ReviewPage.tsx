import { useEffect, useMemo, useState } from 'react'
import { Rating, type Grade } from 'ts-fsrs'
import { ui } from '../components/ui'
import { HighlightedSentence } from '../components/HighlightedSentence'
import { SpeakButton } from '../components/SpeakButton'
import { explainWord, isAiConfigured } from '../lib/ai'
import { restoreWord, saveExplanation, saveReviewedCard, setWordStatus, type WordEntry } from '../lib/db'
import { errorMessage } from '../lib/errors'
import { isTypingTarget, useDueWords, useNow } from '../lib/hooks'
import { useT, useUiLanguage, type MessageKey } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { getSettings, useSettings } from '../lib/settings'
import { formatInterval, GRADES, previewDue, reviewCard } from '../lib/srs'
import { displayTerm } from '../lib/phrases'
import { findTermInText } from '../lib/tokenize'

const GRADE_LABELS: Record<Grade, { label: MessageKey; className: string }> = {
  [Rating.Again]: { label: 'review.again', className: 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10' },
  [Rating.Hard]: { label: 'review.hard', className: 'border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10' },
  [Rating.Good]: { label: 'review.good', className: 'border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-200 dark:hover:bg-emerald-500/10' },
  [Rating.Easy]: { label: 'review.easy', className: 'border-sky-300 text-sky-800 hover:bg-sky-50 dark:border-sky-500/40 dark:text-sky-200 dark:hover:bg-sky-500/10' },
}

export function ReviewPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const now = useNow(15_000)
  const due = useDueWords(now)
  const [revealed, setRevealed] = useState(false)
  const current = due?.[0]
  const settings = useSettings()
  const configured = isAiConfigured(settings)
  // The word as it was before the last answer, so it can be undone.
  const [undoable, setUndoable] = useState<WordEntry | null>(null)
  const [explainError, setExplainError] = useState<{ key: string; message: string } | null>(null)

  // Words saved before the AI was set up have no explanation yet; fetch one while the card is up.
  const needsExplanation = Boolean(current && !current.explanation && current.context && configured)
  // Plain values, so live-query refreshes of the same card don't restart the request.
  const wordKey = current?.key
  const wordTerm = current?.term
  const wordLanguage = current?.language
  const wordContext = current?.context
  useEffect(() => {
    if (!needsExplanation || !wordKey || !wordTerm || !wordLanguage || !wordContext) return
    const controller = new AbortController()
    const settingsNow = getSettings()
    explainWord(
      {
        term: wordTerm,
        surface: findSurface(wordContext, wordTerm, wordLanguage),
        sentence: wordContext,
        language: wordLanguage,
        explanationLanguage: settingsNow.explanationLanguage,
      },
      settingsNow,
      controller.signal,
    ).then(
      (data) => saveExplanation(wordLanguage, wordTerm, data, wordContext),
      (error) => {
        if (!controller.signal.aborted) setExplainError({ key: wordKey, message: errorMessage(error, t) })
      },
    )
    return () => controller.abort()
  }, [needsExplanation, wordKey, wordTerm, wordLanguage, wordContext, t])

  const intervals = useMemo(() => {
    if (!current?.card) return undefined
    const from = new Date(now)
    const preview = previewDue(current.card, from)
    return Object.fromEntries(GRADES.map((grade) => [grade, formatInterval(from, preview[grade])])) as Record<Grade, string>
  }, [current, now])

  async function grade(value: Grade) {
    if (!current?.card) return
    setRevealed(false)
    setUndoable(current)
    await saveReviewedCard(current.key, reviewCard(current.card, value))
  }

  async function markKnown() {
    if (!current) return
    setRevealed(false)
    setUndoable(current)
    await setWordStatus(current.language, current.term, 'known')
  }

  async function undo() {
    if (!undoable) return
    setUndoable(null)
    setRevealed(false)
    await restoreWord(undoable)
  }

  // Re-registered on every render so the handler always sees the current card.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'z' && undoable) {
        void undo()
        return
      }
      if (!current) return
      if (!revealed && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault()
        setRevealed(true)
      } else if (revealed && ['1', '2', '3', '4'].includes(event.key)) {
        void grade(GRADES[Number(event.key) - 1])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (due === undefined) return null

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className={ui.pageTitle}>{t('review.title')}</h1>
        <div className="flex items-baseline gap-3">
          {undoable ? (
            <button type="button" onClick={() => void undo()} className={ui.ghostButton}>
              ↶ {t('review.undo', { word: undoable.term })}
            </button>
          ) : null}
          {due.length > 0 ? <span className={`${ui.muted} tabular-nums`}>{t('review.remaining', { n: due.length })}</span> : null}
        </div>
      </div>

      {!current ? (
        <div className={`${ui.card} flex flex-col items-center gap-2 p-10 text-center`}>
          <p className="text-4xl" aria-hidden="true">
            ✓
          </p>
          <p className="font-medium text-stone-800 dark:text-stone-100">{t('review.empty')}</p>
          <p className={ui.muted}>{t('review.emptyHint')}</p>
          <a href="#/quiz" className={`${ui.secondaryButton} mt-3`}>
            {t('review.tryQuiz')}
          </a>
        </div>
      ) : (
        <div className={`${ui.card} flex flex-col gap-6 p-6 sm:p-8`}>
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {languageName(current.language, uiLanguage)}
            </span>
            <p className="flex items-center gap-1">
              <span lang={current.language} dir="auto" className="font-reading text-4xl font-semibold text-stone-900 dark:text-stone-50">
                {displayTerm(current.term, current.language)}
              </span>
              <SpeakButton text={displayTerm(current.term, current.language)} language={current.language} />
            </p>
            {current.context ? (
              <p lang={current.language} dir="auto" className="font-reading text-stone-600 dark:text-stone-400">
                <HighlightedSentence sentence={current.context} surface={findSurface(current.context, current.term, current.language)} />
              </p>
            ) : null}
          </div>

          {revealed ? (
            <div className="flex flex-col gap-2 border-t border-stone-200 pt-5 text-center dark:border-stone-800">
              {current.explanation ? (
                <>
                  <p className="text-2xl font-semibold text-indigo-700 dark:text-indigo-300">{current.explanation.translation}</p>
                  <p className="text-stone-700 dark:text-stone-300">{current.explanation.meaning}</p>
                  {current.explanation.example ? (
                    <p className="font-reading mt-2 text-sm text-stone-500 italic">{current.explanation.example}</p>
                  ) : null}
                </>
              ) : explainError?.key === current.key ? (
                <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                  {explainError.message}
                </p>
              ) : needsExplanation ? (
                <p className={ui.muted} role="status">
                  {t('review.explaining')}
                </p>
              ) : (
                <p className={ui.muted}>{t('review.noTranslation')}</p>
              )}
            </div>
          ) : null}

          {revealed ? (
            <div className="grid grid-cols-4 gap-2">
              {GRADES.map((value, index) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void grade(value)}
                  className={`flex flex-col items-center rounded-lg border px-2 py-2 text-sm font-medium transition ${GRADE_LABELS[value].className}`}
                >
                  {t(GRADE_LABELS[value].label)}
                  <span className="text-xs font-normal opacity-70 tabular-nums">
                    {index + 1} · {intervals?.[value]}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={() => setRevealed(true)} className={ui.primaryButton}>
              {t('review.show')}
            </button>
          )}

          <div className="flex items-center justify-between">
            <span className="hidden text-xs text-stone-400 sm:inline">{t('review.keys')}</span>
            <button type="button" onClick={() => void markKnown()} className={ui.ghostButton}>
              {t('review.markKnown')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The original spelling, including vowel marks, for highlighting and pronunciation. */
function findSurface(sentence: string, term: string, language: string): string {
  const match = findTermInText(sentence, term, language)
  return match ? sentence.slice(match.start, match.end) : displayTerm(term, language)
}
