import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Rating, type Grade } from 'ts-fsrs'
import { ComprehensionPanel } from '../components/ComprehensionPanel'
import { SpeakButton } from '../components/SpeakButton'
import { ui } from '../components/ui'
import { dayKey, db, recordActivity, recordQuizAnswer, saveReviewedCard, type TextDoc, type WordEntry } from '../lib/db'
import { DAILY_GOALS, createDailySession, dailyExcerpt, dailyLimits, dailyQuizKeys, isDue, loadDailyGoal, loadDailySession, saveDailyGoal, saveDailySession, wordsForText, type DailyGoal, type DailyStage } from '../lib/daily'
import { errorMessage } from '../lib/errors'
import { useNow } from '../lib/hooks'
import { useT, useUiLanguage, type MessageKey } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { displayTerm } from '../lib/phrases'
import { checkTyped, clozeParts } from '../lib/quiz'
import { useSettings } from '../lib/settings'
import { formatInterval, GRADES, previewDue, reviewCard } from '../lib/srs'
import { countWords } from '../lib/tokenize'

const STAGES: DailyStage[] = ['review', 'read', 'quiz', 'done']
const GRADE_LABELS: Record<Grade, MessageKey> = { [Rating.Again]: 'review.again', [Rating.Hard]: 'review.hard', [Rating.Good]: 'review.good', [Rating.Easy]: 'review.easy' }

export function DailyPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const now = useNow()
  const words = useLiveQuery(() => db.words.toArray())
  const texts = useLiveQuery(() => db.texts.toArray())
  const languages = useMemo(() => [...new Set([...(texts ?? []).map((text) => text.language), ...(words ?? []).map((word) => word.language)])].sort(), [words, texts])
  const [requested, setRequested] = useState(settings.lastTextLanguage)
  const language = languages.includes(requested) ? requested : languages[0]

  if (!words || !texts) return null
  return <div className="mx-auto flex max-w-2xl flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className={ui.pageTitle}>{t('daily.title')}</h1><p className={`${ui.muted} mt-2`}>{t('daily.intro')}</p></div>
      {languages.length > 1 ? <label className="flex flex-col gap-1 text-sm"><span>{t('quiz.language')}</span><select value={language} onChange={(event) => setRequested(event.target.value)} className={ui.input}>{languages.map((code) => <option key={code} value={code}>{languageName(code, uiLanguage)}</option>)}</select></label> : null}
    </div>
    {language ? <Session key={`${dayKey(now)}:${language}`} texts={texts} words={words} language={language} now={now} /> : <div className={`${ui.card} flex flex-col items-start gap-3 p-6`}><p>{t('daily.noMaterial')}</p><a href="#/new" className={ui.primaryButton}>{t('daily.addText')}</a></div>}
  </div>
}

function Session({ texts, words, language, now }: { texts: TextDoc[]; words: WordEntry[]; language: string; now: number }) {
  const t = useT()
  const [session, setSession] = useState(() => loadDailySession(language, dayKey(now)) ?? createDailySession(texts, words, language, loadDailyGoal(), now))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  useEffect(() => { saveDailySession(session) }, [session])
  const pool = new Map(words.filter((word) => word.language === language).map((word) => [word.key, word]))
  const reviews = session.reviewKeys.filter((key) => !session.reviewedKeys.includes(key)).map((key) => pool.get(key)).filter((word): word is WordEntry => Boolean(word && isDue(word, now)))
  const currentReview = reviews[0]
  const text = texts.find((candidate) => candidate.id === session.textId)
  const excerpt = useMemo(() => text ? dailyExcerpt(text.content, language, dailyLimits(session.goal).words) : '', [text, language, session.goal])
  const contextualWords = useMemo(() => new Map((text ? wordsForText({ ...text, content: excerpt }, words) : []).map((word) => [word.key, word])), [text, excerpt, words])
  const quizzes = session.quizKeys.filter((key) => !session.answers.some((answer) => answer.key === key)).map((key) => contextualWords.get(key) ?? pool.get(key)).filter((word): word is WordEntry => Boolean(word && word.status !== 'ignored' && (word.translation || clozeParts(word))))
  const currentQuiz = quizzes[0]
  const canChangeGoal = session.stage === 'review' && session.reviewedKeys.length === 0

  async function safely(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (cause) { setError(errorMessage(cause, t)); throw cause } finally { lock.current = false; setBusy(false) }
  }
  function go(stage: DailyStage) { setSession((previous) => ({ ...previous, stage })) }
  async function grade(value: Grade) {
    if (!currentReview?.card) return
    try { await safely(async () => {
      await saveReviewedCard(currentReview.key, reviewCard(currentReview.card!, value))
      setSession((previous) => ({ ...previous, reviewedKeys: [...previous.reviewedKeys, currentReview.key] }))
    }) } catch { /* Error is shown by safely. */ }
  }
  async function finishReading() {
    try { await safely(async () => {
      if (excerpt) await recordActivity({ wordsRead: countWords(excerpt, language) })
      setSession((previous) => ({ ...previous, stage: 'quiz', quizKeys: dailyQuizKeys(text, words, language, previous.goal, now) }))
    }) } catch { /* Error is shown by safely. */ }
  }

  return <>
    <div className={`${ui.card} flex flex-col gap-4 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium" htmlFor="daily-goal">{t('daily.goal')}<select id="daily-goal" className={ui.input} value={session.goal} disabled={!canChangeGoal} onChange={(event) => { const goal = Number(event.target.value) as DailyGoal; saveDailyGoal(goal); setSession(createDailySession(texts, words, language, goal, now)) }}>{DAILY_GOALS.map((goal) => <option key={goal} value={goal}>{t('daily.minutes', { n: goal })}</option>)}</select></label>
        <span className="text-xs text-stone-500">{t('daily.saved')}</span>
      </div>
      <ol className="grid grid-cols-3 gap-2" aria-label={t('daily.steps')}>
        {STAGES.slice(0, 3).map((stage, index) => <li key={stage} aria-current={session.stage === stage ? 'step' : undefined} className={`rounded-lg px-3 py-2 text-center text-sm font-medium ${STAGES.indexOf(session.stage) > index ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : session.stage === stage ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300' : 'bg-stone-100 text-stone-500 dark:bg-stone-800'}`}>{STAGES.indexOf(session.stage) > index ? '✓ ' : `${index + 1}. `}{t(`daily.${stage}`)}</li>)}
      </ol>
    </div>
    {session.stage === 'review' ? currentReview ? <DailyReview key={currentReview.key} word={currentReview} number={session.reviewedKeys.length + 1} total={session.reviewedKeys.length + reviews.length} busy={busy} onGrade={grade} now={now} /> : <StageComplete title={t('daily.reviewsDone', { n: session.reviewedKeys.length })} hint={t('daily.noDue')} action={t('daily.startReading')} onClick={() => go('read')} /> : null}
    {session.stage === 'read' ? <section className={`${ui.card} flex flex-col gap-5 p-6`}>
      {text && excerpt ? <><div><h2 className="text-xl font-semibold" lang={language} dir="auto">{text.title}</h2><p className={`${ui.muted} mt-1`}>{t('daily.readHint', { n: countWords(excerpt, language) })}</p></div><p lang={language} dir="auto" className="font-reading whitespace-pre-wrap text-xl leading-loose">{excerpt}</p><div className="flex flex-wrap items-center gap-3"><SpeakButton text={excerpt} language={language} /><a href={`#/read/${text.id}`} className={ui.secondaryButton}>{t('daily.fullReader')}</a></div><ComprehensionPanel text={excerpt} language={language} title={text.title} /></> : <><h2 className="font-semibold">{t('daily.noReading')}</h2><a href="#/new" className={`${ui.secondaryButton} self-start`}>{t('daily.addText')}</a></>}
      <button type="button" disabled={busy} onClick={() => void finishReading()} className={ui.primaryButton}>{t(excerpt ? 'daily.finishedReading' : 'daily.startQuiz')}</button>
    </section> : null}
    {session.stage === 'quiz' ? currentQuiz ? <DailyQuiz key={currentQuiz.key} word={currentQuiz} number={session.answers.length + 1} total={session.answers.length + quizzes.length} busy={busy} onAnswer={async (correct) => { await safely(async () => { await recordQuizAnswer(currentQuiz.key, correct); setSession((previous) => ({ ...previous, answers: [...previous.answers, { key: currentQuiz.key, correct }] })) }) }} /> : <StageComplete title={t('daily.quizDone', { n: session.answers.length })} hint={session.answers.length ? t('daily.quizScore', { n: session.answers.filter((answer) => answer.correct).length, total: session.answers.length }) : t('daily.noQuiz')} action={t('daily.finish')} onClick={() => go('done')} /> : null}
    {session.stage === 'done' ? <div className={`${ui.card} flex flex-col items-center gap-4 p-8 text-center`}><span aria-hidden="true" className="text-4xl text-emerald-600">✓</span><h2 className="text-2xl font-semibold">{t('daily.done')}</h2><p className={ui.muted}>{t('daily.doneStats', { reviews: session.reviewedKeys.length, quiz: session.answers.length })}</p><p className={ui.muted}>{t('daily.tomorrow')}</p><a href="#/" className={ui.primaryButton}>{t('nav.library')}</a></div> : null}
    {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
  </>
}

function StageComplete({ title, hint, action, onClick }: { title: string; hint: string; action: string; onClick: () => void }) {
  return <div className={`${ui.card} flex flex-col items-start gap-3 p-6`}><h2 className="text-lg font-semibold">{title}</h2><p className={ui.muted}>{hint}</p><button type="button" className={ui.primaryButton} onClick={onClick}>{action}</button></div>
}

function DailyReview({ word, number, total, busy, onGrade, now }: { word: WordEntry; number: number; total: number; busy: boolean; onGrade: (grade: Grade) => Promise<void>; now: number }) {
  const t = useT()
  const [revealed, setRevealed] = useState(false)
  const due = previewDue(word.card!, new Date(now))
  return <div className={`${ui.card} flex flex-col gap-5 p-6`}>
    <p className={ui.muted}>{t('quiz.progress', { i: number, n: total })}</p>
    <p lang={word.language} dir="auto" className="font-reading text-center text-4xl font-semibold">{displayTerm(word.term, word.language)}</p>
    {word.context ? <p lang={word.language} dir="auto" className="font-reading text-center text-stone-600 dark:text-stone-300">{word.context}</p> : null}
    {revealed ? <><p className="text-center text-xl text-indigo-700 dark:text-indigo-300">{word.translation || word.explanation?.translation || t('review.noTranslation')}</p>{word.explanation?.meaning ? <p className="text-center text-sm">{word.explanation.meaning}</p> : null}<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{GRADES.map((grade) => <button type="button" key={grade} disabled={busy} onClick={() => void onGrade(grade)} className={`${ui.secondaryButton} flex flex-col`}>{t(GRADE_LABELS[grade])}<span className="text-xs opacity-60">{formatInterval(new Date(now), due[grade])}</span></button>)}</div></> : <button type="button" className={ui.primaryButton} onClick={() => setRevealed(true)}>{t('review.show')}</button>}
  </div>
}

function DailyQuiz({ word, number, total, busy, onAnswer }: { word: WordEntry; number: number; total: number; busy: boolean; onAnswer: (correct: boolean) => Promise<void> }) {
  const t = useT()
  const [typed, setTyped] = useState('')
  const [verdict, setVerdict] = useState<ReturnType<typeof checkTyped> | null>(null)
  const cloze = word.translation ? undefined : clozeParts(word)
  const answer = displayTerm(word.term, word.language)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !typed.trim()) return
    if (!verdict) setVerdict(checkTyped(typed, [answer], word.language))
    else try { await onAnswer(verdict !== 'wrong') } catch { /* Parent displays the storage error and keeps this answer. */ }
  }
  return <form onSubmit={(event) => void submit(event)} className={`${ui.card} flex flex-col gap-5 p-6`}>
    <p className={ui.muted}>{t('quiz.progress', { i: number, n: total })}</p><p className="text-center text-sm">{t(cloze ? 'quiz.promptCloze' : 'quiz.promptTyping')}</p>
    <p lang={cloze ? word.language : undefined} dir="auto" className="font-reading text-center text-2xl">{cloze ? `${cloze.before} ____ ${cloze.after}` : word.translation}</p>
    <label className="sr-only" htmlFor="daily-answer">{t('quiz.typePlaceholder')}</label><input id="daily-answer" value={typed} onChange={(event) => setTyped(event.target.value)} readOnly={Boolean(verdict)} className={ui.input} autoComplete="off" autoCapitalize="off" spellCheck={false} lang={word.language} dir="auto" autoFocus placeholder={t('quiz.typePlaceholder')} />
    {verdict ? <p role="status" className={verdict === 'wrong' ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>{t(verdict === 'correct' ? 'quiz.correct' : verdict === 'close' ? 'quiz.close' : 'quiz.wrong', { answer })}</p> : null}
    <button type="submit" disabled={busy || !typed.trim()} className={ui.primaryButton}>{t(verdict ? 'quiz.next' : 'quiz.check')}</button>
  </form>
}
