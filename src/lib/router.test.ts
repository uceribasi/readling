import { describe, expect, it } from 'vitest'
import { parseHash } from './router'
describe('feature routes', () => {
  it('opens deep linked pages and text-specific quizzes', () => {
    expect(parseHash('#/read/12?page=3')).toEqual({ name: 'read', id: 12, page: 3 })
    expect(parseHash('#/quiz/en?text=12')).toEqual({ name: 'quiz', language: 'en', textId: 12 })
    expect(parseHash('#/daily')).toEqual({ name: 'daily' })
    expect(parseHash('#/listen')).toEqual({ name: 'listen' })
  })
  it('ignores invalid optional ids and positions', () => {
    expect(parseHash('#/read/1?page=-2')).toEqual({ name: 'read', id: 1 })
    expect(parseHash('#/quiz/en?text=NaN')).toEqual({ name: 'quiz', language: 'en' })
    expect(parseHash('#/read/NaN')).toEqual({ name: 'library' })
  })
})
