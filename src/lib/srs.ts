import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'

const scheduler = fsrs({ enable_fuzz: true })

export const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const satisfies readonly Grade[]

export function newCard(now = new Date()): Card {
  return createEmptyCard(now)
}

export function reviewCard(card: Card, grade: Grade, now = new Date()): Card {
  return scheduler.next(card, now, grade).card
}

/** When the card would next be due for each grade. */
export function previewDue(card: Card, now = new Date()): Record<Grade, Date> {
  const preview = scheduler.repeat(card, now)
  return {
    [Rating.Again]: preview[Rating.Again].card.due,
    [Rating.Hard]: preview[Rating.Hard].card.due,
    [Rating.Good]: preview[Rating.Good].card.due,
    [Rating.Easy]: preview[Rating.Easy].card.due,
  }
}

/** Compact interval label such as "10m", "3h", "4d" or "2mo". */
export function formatInterval(from: Date, to: Date): string {
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(days / 365)}y`
}
