import { useEffect, useState } from 'react'
import { loadAnnotator, READING_LANGUAGES, type Annotator } from './readings'
import { useSettings } from './settings'

export type ReadingsState =
  | { status: 'off' }
  | { status: 'loading'; progress: number }
  | { status: 'ready'; annotator: Annotator }
  | { status: 'error' }

/** Furigana or pinyin for a text's language, loaded once the reader turns readings on. */
export function useReadings(language: string): ReadingsState {
  const enabled = useSettings().showReadings && READING_LANGUAGES.has(language)
  const [state, setState] = useState<ReadingsState>({ status: 'loading', progress: 0 })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadAnnotator(language, (progress) => !cancelled && setState({ status: 'loading', progress })).then(
      (annotator) => !cancelled && setState({ status: 'ready', annotator }),
      () => !cancelled && setState({ status: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [enabled, language])

  return enabled ? state : OFF
}

const OFF: ReadingsState = { status: 'off' }
