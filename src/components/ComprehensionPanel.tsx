import { useEffect, useId, useRef, useState } from 'react'
import { isAiConfigured } from '../lib/ai'
import { comprehensionSource, generateComprehension, type Comprehension } from '../lib/ai/comprehension'
import { errorMessage } from '../lib/errors'
import { useT } from '../lib/i18n'
import { useSettings } from '../lib/settings'
import { ui } from './ui'

export function ComprehensionPanel({ text, language, title }: { text: string; language: string; title?: string }) {
  return <ComprehensionForm key={`${language}:${text}`} text={text} language={language} title={title} />
}

function ComprehensionForm({ text, language, title }: { text: string; language: string; title?: string }) {
  const t = useT()
  const settings = useSettings()
  const prefix = useId()
  const controller = useRef<AbortController | null>(null)
  const [result, setResult] = useState<Comprehension | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<string[]>([])
  const source = comprehensionSource(text)

  useEffect(() => () => controller.current?.abort(), [])

  async function generate() {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setError('')
    try {
      const generated = await generateComprehension(settings, { text: source, language }, active.signal)
      if (!active.signal.aborted) { setResult(generated); setRevealed([]); setAnswers({}) }
    } catch (cause) {
      if (!active.signal.aborted) setError(errorMessage(cause, t))
    } finally {
      if (!active.signal.aborted) setBusy(false)
    }
  }

  return (
    <section className={`${ui.card} flex flex-col gap-4 p-5`} aria-labelledby={`${prefix}-title`}>
      <div>
        <h2 id={`${prefix}-title`} className="font-semibold text-stone-900 dark:text-stone-100">{t('comprehension.title')}</h2>
        <p className={`${ui.muted} mt-1`}>{t('comprehension.intro')}</p>
        {title ? <p className="mt-1 truncate text-xs text-stone-500">{title}</p> : null}
      </div>
      {text.trim().length > source.length ? <p className={ui.muted}>{t('comprehension.excerpt')}</p> : null}
      {!isAiConfigured(settings) ? (
        <div className="flex flex-wrap items-center gap-3"><p className={ui.muted}>{t('story.needsAi')}</p><a href="#/settings" className={ui.secondaryButton}>{t('story.openSettings')}</a></div>
      ) : !result ? (
        <div className="flex items-center gap-3">
          <button type="button" disabled={busy || !source} onClick={() => void generate()} className={ui.primaryButton}>{t(busy ? 'comprehension.generating' : 'comprehension.generate')}</button>
          {busy ? <button type="button" onClick={() => { controller.current?.abort(); setBusy(false) }} className={ui.ghostButton}>{t('comprehension.cancel')}</button> : null}
        </div>
      ) : (
        <>
          {result.questions.map((question) => (
            <div key={question.kind} className="flex flex-col gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
              <label htmlFor={`${prefix}-${question.kind}`} className="text-sm font-medium text-stone-900 dark:text-stone-100">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">{t(`comprehension.${question.kind}`)}</span>
                {question.question}
              </label>
              <textarea id={`${prefix}-${question.kind}`} value={answers[question.kind] ?? ''} onChange={(event) => setAnswers({ ...answers, [question.kind]: event.target.value })} maxLength={4000} rows={2} className={ui.input} placeholder={t('comprehension.answerPlaceholder')} />
              {revealed.includes(question.kind) ? <div className="rounded-lg bg-indigo-50 p-3 dark:bg-indigo-500/10"><p className="text-sm">{question.answer}</p><Evidence source={source} quote={question.evidence} language={language} /></div> : <button type="button" className={`${ui.secondaryButton} self-start`} onClick={() => setRevealed([...revealed, question.kind])}>{t('comprehension.reveal')}</button>}
            </div>
          ))}
          <div className="flex flex-col gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
            <label htmlFor={`${prefix}-summary`} className="text-sm font-medium">{t('comprehension.summary')}</label>
            <textarea id={`${prefix}-summary`} value={answers.summary ?? ''} onChange={(event) => setAnswers({ ...answers, summary: event.target.value })} maxLength={6000} rows={3} className={ui.input} placeholder={t('comprehension.summaryPlaceholder')} />
            {revealed.includes('summary') ? <div className="rounded-lg bg-indigo-50 p-3 dark:bg-indigo-500/10"><p className="text-sm">{result.summary}</p>{result.summaryEvidence.map((quote, index) => <Evidence key={index} source={source} quote={quote} language={language} />)}</div> : <button type="button" className={`${ui.secondaryButton} self-start`} onClick={() => setRevealed([...revealed, 'summary'])}>{t('comprehension.compare')}</button>}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400">{t('comprehension.selfCheck')}</p>
        </>
      )}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
    </section>
  )
}

function Evidence({ source, quote, language }: { source: string; quote: string; language: string }) {
  const t = useT()
  const start = source.indexOf(quote)
  return <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-indigo-700 dark:text-indigo-300">{t('comprehension.evidence')}</summary><blockquote lang={language} dir="auto" className="font-reading mt-2 border-l-2 border-indigo-300 pl-3 leading-relaxed">{start > 120 ? '…' : ''}{source.slice(Math.max(0, start - 120), start)}<mark className="rounded bg-amber-200 px-0.5 text-stone-900 dark:bg-amber-500/40 dark:text-stone-100">{quote}</mark>{source.slice(start + quote.length, start + quote.length + 120)}{start + quote.length + 120 < source.length ? '…' : ''}</blockquote></details>
}
