import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { dayKey, db, type DayActivity, type WordEntry, type WordStatus } from './db'
import { streakOf, type Streak } from './stats'

/** Current time, refreshed on an interval so due cards appear without a reload. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** Learning words whose review is due. `now` only triggers periodic re-checks. */
export function useDueWords(now: number): WordEntry[] | undefined {
  return useLiveQuery(async () => {
    const learning = await db.words.where('status').equals('learning').toArray()
    // Read the clock here, not from `now`, so words saved a moment ago count immediately.
    const cutoff = Date.now()
    return learning
      .filter((word) => word.card && new Date(word.card.due).getTime() <= cutoff)
      .sort((a, b) => new Date(a.card!.due).getTime() - new Date(b.card!.due).getTime())
  }, [now])
}

/** Every tracked word of a language, keyed by normalized term. */
export function useWordMap(language: string): Map<string, WordEntry> {
  const words = useLiveQuery(
    () => (language ? db.words.where('language').equals(language).toArray() : []),
    [language],
  )
  return useMemo(() => new Map((words ?? []).map((word) => [word.term, word])), [words])
}

export interface WordShortcuts {
  /** Set while a word is selected: 1 learning, K known, X ignore. */
  onStatus?: (status: WordStatus) => void
  /** Esc. */
  onClose?: () => void
  /** ← and →, for readers that can step between words. */
  onMove?: (step: 1 | -1) => void
  /** Shift+← and Shift+→: grow or shrink the selection into a phrase. */
  onExtend?: (step: 1 | -1) => void
}

/** Keyboard shortcuts shared by the readers. Re-registered each render so handlers see current state. */
export function useWordShortcuts({ onStatus, onClose, onMove, onExtend }: WordShortcuts): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'arrowright' || key === 'arrowleft') {
        const step = key === 'arrowright' ? 1 : -1
        const handler = event.shiftKey ? onExtend : onMove
        if (!handler) return
        event.preventDefault()
        handler(step)
      } else if (onStatus) {
        if (key === '1') onStatus('learning')
        else if (key === 'k') onStatus('known')
        else if (key === 'x') onStatus('ignored')
        else if (key === 'escape') onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
}

/** True when the user is typing in a form field, so global shortcuts should stay quiet. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

export function isActiveDay(day: DayActivity): boolean {
  return Boolean(day.wordsRead || day.wordsAdded || day.reviews || day.quiz)
}

/** Days in a row with some reading, new words, reviews or tests. */
export function useStreak(): Streak | undefined {
  const now = useNow(60_000)
  const days = useLiveQuery(() => db.activity.toArray())
  return useMemo(
    () => (days ? streakOf(new Set(days.filter(isActiveDay).map((day) => day.date)), dayKey(now)) : undefined),
    [days, now],
  )
}
