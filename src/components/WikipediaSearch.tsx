import { useEffect, useRef, useState } from 'react'
import { useT, useUiLanguage } from '../lib/i18n'
import { languageName } from '../lib/languages'
import { fetchArticle, searchWikipedia, WikipediaError, type WikiArticle, type WikiResult } from '../lib/wikipedia'
import { ui } from './ui'

type State =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'results'; results: WikiResult[] }
  | { status: 'opening'; results: WikiResult[]; title: string }
  | { status: 'error'; message: string; results?: WikiResult[] }

/** Searches Wikipedia in the text's language and hands back the chosen article. */
export function WikipediaSearch({ language, onPick }: { language: string; onPick: (article: WikiArticle) => void }) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  function start(): AbortSignal {
    controller.current?.abort()
    controller.current = new AbortController()
    return controller.current.signal
  }

  function failure(error: unknown): string {
    return t(error instanceof WikipediaError && error.code === 'not-found' ? 'new.wikiNotFound' : 'new.wikiError')
  }

  async function search() {
    if (!query.trim()) return
    const signal = start()
    setState({ status: 'searching' })
    try {
      const results = await searchWikipedia(query.trim(), language, signal)
      setState({ status: 'results', results })
    } catch (error) {
      if (!signal.aborted) setState({ status: 'error', message: failure(error) })
    }
  }

  async function open(result: WikiResult, results: WikiResult[]) {
    const signal = start()
    setState({ status: 'opening', results, title: result.title })
    try {
      onPick(await fetchArticle(result.title, language, signal))
    } catch (error) {
      if (!signal.aborted) setState({ status: 'error', message: failure(error), results })
    }
  }

  const results = 'results' in state ? state.results : undefined

  return (
    <div className={`${ui.card} flex flex-col gap-4 p-4`}>
      <div>
        <label htmlFor="wiki-query" className={ui.label}>
          {t('new.wikiSearchLabel', { language: languageName(language, uiLanguage) })}
        </label>
        {/* Not a nested <form>: this sits inside the New text form. */}
        <div className="flex gap-2">
          <input
            id="wiki-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void search()
            }}
            placeholder={t('new.wikiPlaceholder')}
            lang={language} dir="auto"
            className={ui.input}
          />
          <button type="button" onClick={search} disabled={!query.trim() || state.status === 'searching'} className={ui.secondaryButton}>
            {t('new.wikiSearch')}
          </button>
        </div>
      </div>

      {state.status === 'searching' ? (
        <p className={ui.muted} role="status">
          {t('new.wikiSearching')}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
          {state.message}
        </p>
      ) : null}
      {results && results.length === 0 ? <p className={ui.muted}>{t('new.wikiNoResults')}</p> : null}
      {results && results.length > 0 ? (
        <ul className="-mx-2 flex flex-col">
          {results.map((result) => {
            const opening = state.status === 'opening' && state.title === result.title
            return (
              <li key={result.title}>
                <button
                  type="button"
                  onClick={() => open(result, results)}
                  disabled={state.status === 'opening'}
                  aria-busy={opening}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition hover:bg-stone-100 disabled:opacity-60 dark:hover:bg-stone-800"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span lang={language} dir="auto" className="font-medium text-stone-900 dark:text-stone-50">
                      {result.title}
                    </span>
                    <span className="shrink-0 text-xs text-stone-400 tabular-nums">
                      {opening ? t('new.wikiLoading') : t('library.words', { n: result.wordCount.toLocaleString(uiLanguage) })}
                    </span>
                  </span>
                  <span lang={language} dir="auto" className="line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
                    {result.snippet}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <p className="text-xs text-stone-500 dark:text-stone-400">{t('new.wikiNote')}</p>
    </div>
  )
}
