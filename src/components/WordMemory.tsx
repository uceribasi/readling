import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, wordKey } from '../lib/db'
import { useT } from '../lib/i18n'
import { navigate } from '../lib/router'
import { relatedWords, saveWordFamily, wordFamily } from '../lib/vocabulary'
import { ui } from './ui'

export function WordMemory({ language, term }: { language: string; term: string }) {
  const t = useT()
  const words = useLiveQuery(() => db.words.where('language').equals(language).toArray(), [language])
  const texts = useLiveQuery(() => db.texts.toArray())
  const word = words?.find((word) => word.key === wordKey(language, term))
  const [family, setFamily] = useState<string | null>(null)
  const [error, setError] = useState(false)
  if (!word) return null
  const related = relatedWords(word, words ?? [])
  const contexts = [...(word.contexts ?? (word.context ? [{ id: `${word.key}:legacy`, sentence: word.context, translation: word.translation, explanation: word.explanation, seenAt: word.createdAt, source: undefined }] : []))].sort((a, b) => b.seenAt - a.seenAt)
  return <div className="space-y-3 border-t border-stone-200 pt-3 dark:border-stone-700">
    <details>
      <summary className="cursor-pointer text-sm font-medium">{t('memory.history', { n: contexts.length })}</summary>
      <ul className="mt-3 max-h-72 space-y-3 overflow-auto">
        {contexts.map((context) => {
          const source = texts?.find((text) => text.syncId === context.source?.id)
          return <li key={context.id} className="rounded-lg bg-stone-100 p-3 text-sm dark:bg-stone-800">
            <p lang={language} dir="auto" className="font-reading">{context.sentence}</p>
            {context.translation ? <p dir="auto" className="mt-1 text-indigo-700 dark:text-indigo-300">{context.translation}</p> : null}
            {context.explanation?.meaning ? <p dir="auto" className="mt-1 text-stone-500">{context.explanation.meaning}</p> : null}
            {source ? <button className={`${ui.ghostButton} mt-1 max-w-full truncate text-xs`} onClick={() => navigate(`/read/${source.id}?page=${context.source?.page ?? 0}`)}>{context.source?.title || source.title} →</button>
              : context.source?.url && /^https?:\/\//.test(context.source.url) ? <a className="mt-2 block underline" href={context.source.url} target="_blank" rel="noreferrer">{context.source.title || t('memory.source')} ↗</a> : null}
          </li>
        })}
      </ul>
      {!contexts.length ? <p className={`${ui.muted} mt-2`}>{t('memory.empty')}</p> : null}
    </details>
    <details>
      <summary className="cursor-pointer text-sm font-medium">{t('memory.family')}: <span lang={language}>{wordFamily(word)}</span></summary>
      <p className={`${ui.muted} mt-2`}>{t('memory.familyHint')}</p>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (event) => {
        event.preventDefault()
        setError(false)
        try { await saveWordFamily(word.key, family ?? wordFamily(word)); setFamily(null) }
        catch { setError(true) }
      }}>
        <label className="min-w-0 flex-1"><span className="sr-only">{t('memory.family')}</span><input className={ui.input} maxLength={100} value={family ?? wordFamily(word)} onChange={(event) => setFamily(event.target.value)} /></label>
        <button className={ui.secondaryButton} type="submit">{t('memory.save')}</button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-red-600">{t('memory.error')}</p> : null}
      <ul className="mt-3 flex flex-wrap gap-2">{related.map((item) => <li key={item.key} className="rounded border border-stone-300 px-2 py-1 text-sm dark:border-stone-600"><span lang={language}>{item.term}</span>{item.translation ? ` · ${item.translation}` : ''}</li>)}</ul>
      {!related.length ? <p className={`${ui.muted} mt-2`}>{t('memory.noFamily')}</p> : null}
    </details>
  </div>
}
