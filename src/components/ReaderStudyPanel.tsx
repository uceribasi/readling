import { lazy, Suspense, useState } from 'react'
import type { TextDoc } from '../lib/db'
import { useT } from '../lib/i18n'
import { ui } from './ui'
const ComprehensionPanel = lazy(() => import('./ComprehensionPanel').then((module) => ({ default: module.ComprehensionPanel })))

export function ReaderStudyPanel({ text, excerpt }: { text: TextDoc; excerpt: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return <section className="mt-6 space-y-3 border-t border-stone-200 pt-5 dark:border-stone-800">
    <div className="flex flex-wrap gap-2">
      <a href={`#/quiz/${text.language}?text=${text.id}`} className={ui.secondaryButton}>{t('textQuiz.scope', { title: text.title })}</a>
      <button type="button" className={ui.secondaryButton} aria-expanded={open} onClick={() => setOpen(!open)}>{t('comprehension.title')}</button>
    </div>
    {open ? <Suspense fallback={<p role="status" className={ui.muted}>…</p>}><ComprehensionPanel key={excerpt} text={excerpt} language={text.language} title={text.title} /></Suspense> : null}
  </section>
}
