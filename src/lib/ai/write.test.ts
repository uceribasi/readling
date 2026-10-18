import { describe, expect, it } from 'vitest'
import { parseWrittenText, simplifyPrompt, storyPrompt } from './write'

describe('AI writing', () => {
  it('asks for a story at the chosen level that uses the learner’s words', () => {
    const prompt = storyPrompt({ language: 'es', level: 'A2', topic: 'a lighthouse cat', length: 'short', words: ['escalera', 'faro'] })
    expect(prompt.system).toContain('Spanish')
    expect(prompt.system).toContain('CEFR level A2')
    expect(prompt.system).toContain('about 150 words')
    expect(prompt.system).toContain('escalera, faro')
    expect(prompt.user).toBe('Topic: a lighthouse cat')
    expect(prompt.schema).toBeDefined()
  })

  it('leaves the topic to the model when none is given', () => {
    expect(storyPrompt({ language: 'de', level: 'B1', topic: ' ', length: 'long', words: [] }).user).toContain('anything')
  })

  it('keeps rewrites in the original language', () => {
    const prompt = simplifyPrompt({ language: 'fr', level: 'A1', title: 'Le phare', text: 'Il était une fois.' })
    expect(prompt.system).toContain("Keep it in French; don't translate it.")
    expect(prompt.user).toBe('Title: Le phare\n\nIl était une fois.')
  })

  it('separates paragraphs with blank lines and rejects empty texts', () => {
    expect(parseWrittenText({ title: ' El gato ', text: 'Uno.\nDos.' })).toEqual({ title: 'El gato', text: 'Uno.\n\nDos.' })
    expect(parseWrittenText({ title: 'X', text: 'Uno.\n\nDos.\nTres.' }).text).toBe('Uno.\n\nDos.\nTres.')
    expect(() => parseWrittenText({ title: 'X', text: '' })).toThrow()
  })
})
