import { describe, expect, it } from 'vitest'
import { voiceScore } from './speech'

const voice = (name: string, extra: Partial<{ localService: boolean; default: boolean }> = {}) => ({
  name,
  localService: true,
  default: false,
  ...extra,
})

describe('voiceScore', () => {
  // Voice names as Chrome on macOS lists them for English, in a Turkish system.
  const english = ['Albert', 'Bahh', 'Bubbles', 'Eddy (İngilizce (Amerika Birleşik Devletleri))', 'İyi Haber', 'Org', 'Samantha', 'Whisper']

  it('prefers natural voices over robotic ones and never picks sound effects first', () => {
    const ranked = english.map((name) => voice(name)).sort((a, b) => voiceScore(b) - voiceScore(a))
    expect(ranked[0].name).toBe('Samantha')
    expect(ranked[1].name).toMatch(/^Eddy/)
    for (const name of ['Albert', 'Bahh', 'Bubbles', 'İyi Haber', 'Org', 'Whisper']) expect(voiceScore(voice(name))).toBeLessThan(0)
  })

  it('rates enhanced and cloud voices highly', () => {
    expect(voiceScore(voice('Samantha (Enhanced)'))).toBeGreaterThan(voiceScore(voice('Samantha')))
    expect(voiceScore(voice('Google español', { localService: false }))).toBeGreaterThan(voiceScore(voice('Eddy (Spanish (Spain))')))
  })
})
