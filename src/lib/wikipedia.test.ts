import { describe, expect, it } from 'vitest'
import { cleanExtract } from './wikipedia'

describe('cleanExtract', () => {
  it('keeps prose and headings, and drops empty sections and the reference sections', () => {
    const extract = [
      'Un faro ( ) es una torre​ luminosa.',
      'Sirve a los navegantes.',
      '',
      '',
      '== Historia ==',
      '',
      '=== Antigüedad ===',
      'El faro de Alejandría.',
      '== Galería ==',
      '== Véase también ==',
      'Faro de Hércules',
      '== Referencias ==',
    ].join('\n')
    expect(cleanExtract(extract).split('\n\n')).toEqual([
      'Un faro es una torre luminosa.',
      'Sirve a los navegantes.',
      'Antigüedad',
      'El faro de Alejandría.',
    ])
  })
})
