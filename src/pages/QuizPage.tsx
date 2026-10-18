import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { SpeakButton } from '../components/SpeakButton'
import { ui } from '../components/ui'
import { db, queueForReview, recordQuizAnswer, type WordEntry } from '../lib/db'
import { isTypingTarget } from '../lib/hooks'
import { useT, useUiLanguage, type MessageKey } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { buildQuiz, checkTyped, inScope, isQuizzable, type Question, type QuizScope, type TypedVerdict } from '../lib/quiz'
import { displayTerm } from '../lib/phrases'

const SCOPES: { id: QuizScope; label: MessageKey }[] = [
  { id: 'learning', label: 'quiz.scopeLearning' },
  { id: 'known', label: 'quiz.scopeKnown' },
  { id: 'weak', label: 'quiz.scopeWeak' },
  { id: 'all', label: 'quiz.scopeAll' },
]
const COUNTS = [10, 20, 30]

interface Answer {
  correct: boolean
  given: string
  verdict?: TypedVerdict
}

type Phase =
  | { name: 'setup' }
  | { name: 'running'; questions: Question[]; answers: Answer[] }
  | { name: 'done'; questions: Question[]; answers: Answer[] }

export function QuizPage({ language: requested }: { language?: string }) {
  const t = useT()
  const words = useLiveQuery(() => db.words.toArray())
  const [phase, setPhase] = useState<Phase>({ name: 'setup' })

  if (words === undefined) return null

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className={ui.pageTitle}>{t('quiz.title')}</h1>
      {phase.name === 'setup' ? (
        <QuizSetup words={words} requested={requested} onStart={(questions) => setPhase({ name: 'running', questions, answers: [] })} />
      ) : phase.name === 'running' ? (
        <QuizRun
          // Remount per question so its local state starts fresh.
          key={phase.answers.length}
          question={phase.questions[phase.answers.length]}
          number={phase.answers.length + 1}
          total={phase.questions.length}
          onDone={(answer) => {
            const answers = [...phase.answers, answer]
            setPhase(
              answers.length === phase.questions.length
                ? { name: 'done', questions: phase.questions, answers }
                : { ...phase, answers },
            )
          }}
        />
      ) : (
        <QuizResult questions={phase.questions} answers={phase.answers} onRestart={() => setPhase({ name: 'setup' })} />
      )}
    </div>
  )
}

function QuizSetup({
  words,
  requested,
  onStart,
}: {
  words: WordEntry[]
  requested?: string
  onStart: (questions: Question[]) => void
}) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const usable = useMemo(() => words.filter((word) => word.status !== 'ignored' && isQuizzable(word)), [words])
  const languages = useMemo(() => {
    const counts = new Map<string, number>()
    for (const word of usable) counts.set(word.language, (counts.get(word.language) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [usable])

  const [language, setLanguage] = useState(() =>
    requested && languages.some(([code]) => code === requested) ? requested : (languages[0]?.[0] ?? ''),
  )
  const [scope, setScope] = useState<QuizScope>('all')
  const [count, setCount] = useState(10)

  const pool = usable.filter((word) => word.language === language)
  const targets = pool.filter((word) => inScope(word, scope))
  const withTranslation = pool.filter((word) => word.translation).length

  if (languages.length === 0) {
    return (
      <div className={`${ui.card} flex flex-col items-center gap-2 p-10 text-center`}>
        <p className="font-medium text-stone-800 dark:text-stone-100">{t('quiz.noWords')}</p>
        <p className={ui.muted}>{t('quiz.noWordsHint')}</p>
        <a href="#/" className={`${ui.secondaryButton} mt-2`}>
          {t('nav.library')}
        </a>
      </div>
    )
  }

  return (
    <div className={`${ui.card} flex flex-col gap-5 p-5 sm:p-6`}>
      <p className={ui.muted}>{t('quiz.subtitle')}</p>

      {languages.length > 1 ? (
        <div>
          <label htmlFor="quiz-language" className={ui.label}>
            {t('quiz.language')}
          </label>
          <select id="quiz-language" value={language} onChange={(event) => setLanguage(event.target.value)} className={ui.input}>
            {languages.map(([code, n]) => (
              <option key={code} value={code}>
                {languageName(code, uiLanguage)} ({n})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ChoiceRow label={t('quiz.scope')}>
        {SCOPES.map((item) => {
          const n = pool.filter((word) => inScope(word, item.id)).length
          return (
            <Choice key={item.id} selected={scope === item.id} onSelect={() => setScope(item.id)} disabled={n === 0}>
              {t(item.label)} <span className="opacity-60 tabular-nums">{n}</span>
            </Choice>
          )
        })}
      </ChoiceRow>

      <ChoiceRow label={t('quiz.count')}>
        {COUNTS.map((n) => (
          <Choice key={n} selected={count === n} onSelect={() => setCount(n)}>
            {n}
          </Choice>
        ))}
      </ChoiceRow>

      {withTranslation < 4 ? <p className="text-sm text-amber-700 dark:text-amber-400">{t('quiz.fewChoices')}</p> : null}

      <button
        type="button"
        disabled={targets.length === 0}
        onClick={() => onStart(buildQuiz(targets, pool, count))}
        className={ui.primaryButton}
      >
        {t('quiz.start', { n: Math.min(count, targets.length) })}
      </button>
    </div>
  )
}

function ChoiceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className={ui.label}>{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {children}
      </div>
    </div>
  )
}

function Choice({
  selected,
  onSelect,
  disabled,
  children,
}: {
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-400 dark:bg-indigo-500/15 dark:text-indigo-200'
          : 'border-stone-200 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
      }`}
    >
      {children}
    </button>
  )
}

const PROMPTS: Record<Question['kind'], MessageKey> = {
  meaning: 'quiz.promptMeaning',
  reverse: 'quiz.promptReverse',
  cloze: 'quiz.promptCloze',
  typing: 'quiz.promptTyping',
}

function QuizRun({
  question,
  number,
  total,
  onDone,
}: {
  question: Question
  number: number
  total: number
  onDone: (answer: Answer) => void
}) {
  const t = useT()
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [typed, setTyped] = useState('')
  const [showHint, setShowHint] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { word } = question
  const options = 'options' in question ? question.options : undefined

  useEffect(() => inputRef.current?.focus(), [])

  function submit(given: string) {
    if (answer) return
    let result: Answer
    if (options) {
      result = { correct: given === question.answer, given }
    } else {
      const accepted = question.kind === 'typing' ? question.accepted : [question.answer]
      const verdict = checkTyped(given, accepted, word.language)
      result = { correct: verdict !== 'wrong', given, verdict }
    }
    setAnswer(result)
    void recordQuizAnswer(word.key, result.correct)
  }

  function onTypedSubmit(event: FormEvent) {
    event.preventDefault()
    if (answer) onDone(answer)
    else if (typed.trim()) submit(typed)
  }

  // Re-registered on every render so the handler sees the current answer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (answer && event.key === 'Enter' && !isTypingTarget(event.target)) {
        event.preventDefault()
        onDone(answer)
      } else if (!answer && options && !isTypingTarget(event.target)) {
        const index = Number(event.key) - 1
        if (index >= 0 && index < options.length) submit(options[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const translation = word.translation ?? ''

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${((number - 1) / total) * 100}%` }} />
        </div>
        <span className={`${ui.muted} tabular-nums`}>{t('quiz.progress', { i: number, n: total })}</span>
      </div>

      <div className={`${ui.card} flex flex-col gap-5 p-6 sm:p-8`}>
        <p className="text-center text-sm font-medium text-stone-500 dark:text-stone-400">{t(PROMPTS[question.kind])}</p>

        {question.kind === 'meaning' ? (
          <p lang={word.language} dir="auto" className="font-reading text-center text-4xl font-semibold text-stone-900 dark:text-stone-50">
            {displayTerm(word.term, word.language)}
          </p>
        ) : question.kind === 'cloze' ? (
          <p lang={word.language} dir="auto" className="font-reading text-center text-xl leading-relaxed text-stone-800 dark:text-stone-200">
            {question.before}
            <span className="mx-1 inline-block min-w-16 border-b-2 border-indigo-500 text-indigo-700 dark:text-indigo-300">
              {answer ? displayTerm(word.term, word.language) : ' '}
            </span>
            {question.after}
          </p>
        ) : (
          <p className="text-center text-3xl font-semibold text-indigo-700 dark:text-indigo-300">{translation}</p>
        )}

        {options ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((option, index) => {
              const isAnswer = option === question.answer
              const isChosen = answer?.given === option
              const state = !answer
                ? 'border-stone-200 hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-stone-700 dark:hover:border-indigo-500/60 dark:hover:bg-indigo-500/5'
                : isAnswer
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100'
                  : isChosen
                    ? 'border-red-500 bg-red-50 text-red-900 dark:bg-red-500/15 dark:text-red-100'
                    : 'border-stone-200 opacity-50 dark:border-stone-700'
              return (
                <button
                  key={option}
                  type="button"
                  disabled={Boolean(answer)}
                  onClick={() => submit(option)}
                  lang={question.kind === 'meaning' ? undefined : word.language} dir="auto"
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${state}`}
                >
                  <kbd className="flex size-6 shrink-0 items-center justify-center rounded border border-current text-xs opacity-60">
                    {index + 1}
                  </kbd>
                  <span className={question.kind === 'meaning' ? '' : 'font-reading text-lg'}>{option}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <form onSubmit={onTypedSubmit} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                readOnly={Boolean(answer)}
                lang={word.language} dir="auto"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={t('quiz.typePlaceholder')}
                className={`${ui.input} font-reading text-lg ${
                  answer ? (answer.correct ? 'border-emerald-500' : 'border-red-500') : ''
                }`}
              />
              <button type="submit" disabled={!answer && !typed.trim()} className={ui.primaryButton}>
                {answer ? (number === total ? t('quiz.finish') : t('quiz.next')) : t('quiz.check')}
              </button>
            </div>
            {!answer ? (
              <button type="button" onClick={() => setShowHint(true)} className={`${ui.ghostButton} self-start`}>
                {showHint ? t('quiz.hintText', { letter: question.answer[0], n: question.answer.length }) : t('quiz.hint')}
              </button>
            ) : null}
          </form>
        )}

        {answer ? (
          <div
            role="status"
            className={`rounded-lg p-4 text-sm ${
              answer.correct
                ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100'
                : 'bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-100'
            }`}
          >
            <p className="font-semibold">
              {answer.verdict === 'close'
                ? t('quiz.close', { answer: question.answer })
                : answer.correct
                  ? t('quiz.correct')
                  : t('quiz.wrong', { answer: question.answer })}
            </p>
            <p className="mt-1 flex items-center gap-1">
              <span lang={word.language} dir="auto" className="font-reading font-semibold">
                {displayTerm(word.term, word.language)}
              </span>
              {translation ? <span>— {translation}</span> : null}
              <SpeakButton text={displayTerm(word.term, word.language)} language={word.language} className="-my-1 size-7" />
            </p>
            {word.context && question.kind !== 'cloze' ? (
              <p lang={word.language} dir="auto" className="font-reading mt-1 opacity-80">
                {word.context}
              </p>
            ) : null}
          </div>
        ) : null}

        {answer && options ? (
          <button type="button" onClick={() => onDone(answer)} className={ui.primaryButton} autoFocus>
            {number === total ? t('quiz.finish') : t('quiz.next')}
          </button>
        ) : null}
      </div>

      <p className="hidden text-center text-xs text-stone-400 sm:block">{t('quiz.keys')}</p>
    </div>
  )
}

function QuizResult({
  questions,
  answers,
  onRestart,
}: {
  questions: Question[]
  answers: Answer[]
  onRestart: () => void
}) {
  const t = useT()
  const [queued, setQueued] = useState(false)
  const correct = answers.filter((answer) => answer.correct).length
  const percent = Math.round((correct / questions.length) * 100)
  const missed = questions.filter((_, index) => !answers[index].correct).map((question) => question.word)
  // A word can appear once per test, but keep this safe if that ever changes.
  const missedWords = [...new Map(missed.map((word) => [word.key, word])).values()]

  return (
    <div className={`${ui.card} flex flex-col gap-6 p-6 sm:p-8`}>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-5xl font-semibold text-stone-900 tabular-nums dark:text-stone-50">{t('quiz.percent', { p: percent })}</p>
        <p className={ui.muted}>{t('quiz.score', { correct, total: questions.length })}</p>
      </div>

      {missedWords.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-stone-700 dark:text-stone-300">{t('quiz.mistakes')}</p>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {missedWords.map((word) => (
              <li key={word.key} className="flex items-baseline justify-between gap-3 px-3 py-2">
                <span lang={word.language} dir="auto" className="font-reading font-semibold text-stone-900 dark:text-stone-50">
                  {displayTerm(word.term, word.language)}
                </span>
                <span className="text-right text-sm text-indigo-700 dark:text-indigo-300">{word.translation}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={queued}
            onClick={() => void queueForReview(missedWords.map((word) => word.key)).then(() => setQueued(true))}
            className={ui.secondaryButton}
          >
            {queued ? `✓ ${t('quiz.queued')}` : t('quiz.queueMistakes', { n: missedWords.length })}
          </button>
        </div>
      ) : (
        <p className="text-center text-emerald-700 dark:text-emerald-400">{t('quiz.noMistakes')}</p>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <a href="#/words" className={ui.secondaryButton}>
          {t('quiz.backToWords')}
        </a>
        <button type="button" onClick={onRestart} className={ui.primaryButton}>
          {t('quiz.again')}
        </button>
      </div>
    </div>
  )
}
