import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { isAiConfigured } from '../lib/ai'
import { STORY_LENGTHS, writeStory, type StoryLength } from '../lib/ai/write'
import { db } from '../lib/db'
import { practiceWords, type StoryPractice } from '../lib/daily'
import { useNow } from '../lib/hooks'
import { errorMessage } from '../lib/errors'
import { useT, type MessageKey } from '../lib/i18n'
import { LEVELS, type Level } from '../lib/levels'
import { updateSettings, useSettings } from '../lib/settings'
import { ui } from './ui'

/** How many learning words a story tries to use; more makes stories feel forced. */
const MAX_STORY_WORDS = 10

export function LevelSelect({ id, value, onChange }: { id: string; value: Level; onChange: (level: Level) => void }) {
  const t = useT()
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value as Level)} className={ui.input}>
      {LEVELS.map((level) => (
        <option key={level} value={level}>
          {level} · {t(`levelName.${level}` as MessageKey)}
        </option>
      ))}
    </select>
  )
}

/** Writes a story at the learner's level, optionally around the words they're learning. */
interface StoryGeneratorProps {
  language: string
  onWritten: (story: { title: string; text: string }) => void
}

export function StoryGenerator(props: StoryGeneratorProps) {
  return <StoryForm key={props.language} {...props} />
}

function StoryForm({ language, onWritten }: StoryGeneratorProps) {
  const t = useT()
  const settings = useSettings()
  const [topic, setTopic] = useState('')
  const [length, setLength] = useState<StoryLength>('short')
  const [useWords, setUseWords] = useState(true)
  const [practice, setPractice] = useState<StoryPractice>('recent')
  const now = useNow()
  const [state, setState] = useState<{ status: 'idle' | 'writing' } | { status: 'error'; message: string }>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  const words = useLiveQuery(
    () => db.words.where('language').equals(language).toArray(),
    [language],
  )
  const learning = practiceWords(words ?? [], practice, MAX_STORY_WORDS, now).map((word) => word.term)

  async function write() {
    controller.current?.abort()
    controller.current = new AbortController()
    const signal = controller.current.signal
    setState({ status: 'writing' })
    try {
      const story = await writeStory(
        settings,
        { language, level: settings.readingLevel, topic, length, words: useWords ? (learning ?? []) : [] },
        signal,
      )
      if (signal.aborted) return
      setState({ status: 'idle' })
      onWritten(story)
    } catch (error) {
      if (!signal.aborted) setState({ status: 'error', message: errorMessage(error, t) })
    }
  }

  if (!isAiConfigured(settings)) {
    return (
      <div className={`${ui.card} flex flex-col items-start gap-3 p-4`}>
        <p className="text-sm text-stone-700 dark:text-stone-300">{t('story.needsAi')}</p>
        <a href="#/settings" className={ui.secondaryButton}>
          {t('story.openSettings')}
        </a>
      </div>
    )
  }

  return (
    <div className={`${ui.card} flex flex-col gap-4 p-4`}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div>
          <label htmlFor="story-level" className={ui.label}>
            {t('story.level')}
          </label>
          <LevelSelect id="story-level" value={settings.readingLevel} onChange={(readingLevel) => updateSettings({ readingLevel })} />
        </div>
        <div>
          <label htmlFor="story-topic" className={ui.label}>
            {t('story.topic')}
          </label>
          <input
            id="story-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={(event) => {
              // Enter writes a story instead of submitting the outer form.
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (state.status !== 'writing') void write()
            }}
            placeholder={t('story.topicPlaceholder')}
            className={ui.input}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <fieldset className="flex items-center gap-2">
          <legend className="sr-only">{t('story.length')}</legend>
          <span className="text-sm text-stone-600 dark:text-stone-400" aria-hidden="true">
            {t('story.length')}
          </span>
          <div className="flex rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
            {(Object.keys(STORY_LENGTHS) as StoryLength[]).map((option) => (
              <label
                key={option}
                className={`cursor-pointer rounded-md px-3 py-1 text-sm transition focus-within:ring-2 focus-within:ring-indigo-500 ${
                  length === option
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                }`}
              >
                <input type="radio" name="story-length" value={option} checked={length === option} onChange={() => setLength(option)} className="sr-only" />
                {t(`story.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {words && words.some((word) => word.status !== 'ignored') ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <input type="checkbox" checked={useWords} onChange={(event) => setUseWords(event.target.checked)} className="size-4 accent-indigo-600" />
            {t('story.useWords', { n: learning.length })}
          </label>
        ) : null}
      </div>

      {useWords ? <div className="flex flex-col gap-2">
        <label htmlFor="story-practice" className={ui.label}>{t('storyPractice.source')}</label>
        <select id="story-practice" value={practice} disabled={state.status === 'writing'} onChange={(event) => setPractice(event.target.value as StoryPractice)} className={ui.input}>
          {(['recent', 'weak', 'due'] as const).map((mode) => <option key={mode} value={mode}>{t(`storyPractice.${mode}`)}</option>)}
        </select>
        <p className="text-xs text-stone-500 dark:text-stone-400">{learning.length ? learning.join(' · ') : t('storyPractice.empty')}</p>
      </div> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={write} disabled={state.status === 'writing'} className={ui.primaryButton}>
          {state.status === 'writing' ? t('story.writing') : t('story.write')}
        </button>
        <span className="text-xs text-stone-500 dark:text-stone-400">{t('story.note')}</span>
      </div>

      {state.status === 'error' ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
