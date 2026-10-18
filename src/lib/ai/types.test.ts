import { describe, expect, it } from 'vitest'
import { AiError, buildPrompt, parseExplanation } from './types'

const full = {
  lemma: 'escalera',
  partOfSpeech: 'noun',
  translation: 'staircase',
  meaning: 'The stairs in the lighthouse.',
  grammar: 'Feminine noun.',
  example: 'La escalera es estrecha.',
  exampleTranslation: 'The staircase is narrow.',
}

describe('parseExplanation', () => {
  it('reads a plain JSON answer', () => {
    expect(parseExplanation(JSON.stringify(full))).toEqual(full)
  })

  it('tolerates code fences, surrounding text and reasoning tags', () => {
    const text = `<think>Let me think {about} it.</think>Sure!\n\`\`\`json\n${JSON.stringify(full)}\n\`\`\``
    expect(parseExplanation(text)).toEqual(full)
  })

  it('fills missing or non-string fields with empty strings and trims', () => {
    const parsed = parseExplanation(JSON.stringify({ translation: ' staircase ', grammar: 42 }))
    expect(parsed.translation).toBe('staircase')
    expect(parsed.grammar).toBe('')
    expect(parsed.example).toBe('')
  })

  it('rejects answers without JSON or without any meaning', () => {
    expect(() => parseExplanation('I do not know.')).toThrow(AiError)
    expect(() => parseExplanation('{"lemma": "x"}')).toThrow(AiError)
    expect(() => parseExplanation('{not json}')).toThrow(AiError)
  })
})

describe('buildPrompt', () => {
  it('names both languages and passes the sentence and word', () => {
    const { system, user } = buildPrompt({
      term: 'escalera',
      surface: 'escalera',
      sentence: 'Marlo subía la escalera.',
      language: 'es',
      explanationLanguage: 'tr',
    })
    expect(system).toContain('Spanish')
    expect(system).toContain('Turkish')
    expect(user).toBe('Sentence: Marlo subía la escalera.\nSelected word: escalera')
  })
})
