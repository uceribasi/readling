import { dayKey } from './db'
import { LEVELS, type Level } from './levels'

/** The last `count` local days, oldest first, ending with `today`. */
export function lastDays(count: number, today = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - i))
    return dayKey(day)
  })
}

function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return dayKey(new Date(year, month - 1, date - 1))
}

export interface Streak {
  current: number
  best: number
  activeToday: boolean
}

/**
 * Consecutive active days. A streak still counts while today has no activity yet,
 * so it doesn't look broken first thing in the morning.
 */
export function streakOf(activeDays: ReadonlySet<string>, today = dayKey()): Streak {
  const activeToday = activeDays.has(today)
  let current = 0
  for (let day = activeToday ? today : previousDay(today); activeDays.has(day); day = previousDay(day)) current++

  let best = 0
  for (const day of activeDays) {
    // Only count from the first day of each run.
    if (activeDays.has(previousDay(day))) continue
    let length = 0
    for (let next = day; activeDays.has(next); length++) {
      const [year, month, date] = next.split('-').map(Number)
      next = dayKey(new Date(year, month - 1, date + 1))
    }
    best = Math.max(best, length)
  }
  return { current, best, activeToday }
}

/**
 * Known word forms needed for each level. A rough guide: readling counts every form
 * ("casa", "casas") separately, and vocabulary is only part of a level.
 */
const LEVEL_THRESHOLDS: Record<Level, number> = { A1: 0, A2: 1_000, B1: 2_500, B2: 5_000, C1: 9_000, C2: 15_000 }

/** Languages with many word forms per word need more known forms for the same level. */
const FORM_FACTOR: Record<string, number> = {
  en: 1,
  zh: 1,
  ja: 1.2,
  ko: 1.6,
  ru: 1.6,
  uk: 1.6,
  pl: 1.6,
  tr: 1.6,
  ar: 1.6,
  he: 1.5,
  sv: 1.2,
}

export interface LevelEstimate {
  level: Level
  next?: Level
  /** Known forms needed to reach the next level. */
  nextAt?: number
  /** Progress from this level towards the next, 0 to 1. */
  progress: number
}

export function estimateLevel(knownWords: number, language: string): LevelEstimate {
  const factor = FORM_FACTOR[language] ?? 1.3
  const threshold = (level: Level) => Math.round(LEVEL_THRESHOLDS[level] * factor)
  let index = 0
  while (index < LEVELS.length - 1 && knownWords >= threshold(LEVELS[index + 1])) index++
  const level = LEVELS[index]
  const next = LEVELS[index + 1]
  if (!next) return { level, progress: 1 }
  const from = threshold(level)
  const nextAt = threshold(next)
  return { level, next, nextAt, progress: (knownWords - from) / (nextAt - from) }
}
