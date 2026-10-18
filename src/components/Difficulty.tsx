import { useMemo } from 'react'
import { difficultyOf, measureText, MIN_KNOWN_FOR_DIFFICULTY, unknownShare, type Difficulty, type TextProgress } from '../lib/difficulty'
import { useWordMap } from '../lib/hooks'
import { useT, useUiLanguage } from '../lib/i18n'
import { countWords } from '../lib/tokenize'

const STYLE: Record<Difficulty, string> = {
  easy: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30',
  good: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30',
  challenging: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30',
  hard: 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/30',
}

/** "Good level · 18% new words", colored by how hard the text is for this reader. */
export function DifficultyBadge({ progress, compact = false }: { progress: TextProgress; compact?: boolean }) {
  const t = useT()
  const difficulty = difficultyOf(progress)
  const percent = Math.round(unknownShare(progress) * 100)
  return (
    <span
      title={compact ? t('difficulty.newWords', { p: percent }) : undefined}
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLE[difficulty]}`}
    >
      {t(`difficulty.${difficulty}`)}
      {compact ? null : <span className="font-normal opacity-80">· {t('difficulty.newWords', { p: percent })}</span>}
    </span>
  )
}

/** "1,678 words · 674 unique words · Good level", for a text about to be added. */
export function TextInfo({ text, language }: { text: string; language: string }) {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const wordMap = useWordMap(language)
  const measured = useMemo(
    () => (text ? { words: countWords(text, language), ...measureText(text, language, wordMap) } : null),
    [text, language, wordMap],
  )
  const knownInLanguage = useMemo(() => {
    let count = 0
    for (const word of wordMap.values()) if (word.status === 'known') count++
    return count
  }, [wordMap])
  if (!measured) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
      <span className="tabular-nums">
        {t('library.words', { n: measured.words.toLocaleString(uiLanguage) })} ·{' '}
        {t('difficulty.unique', { n: measured.total.toLocaleString(uiLanguage) })}
      </span>
      {knownInLanguage >= MIN_KNOWN_FOR_DIFFICULTY ? <DifficultyBadge progress={measured} /> : null}
    </div>
  )
}
