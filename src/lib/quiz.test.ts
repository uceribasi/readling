import { describe, expect, it } from 'vitest'
import type { WordEntry } from './db'
import { buildQuiz, checkTyped, clozeParts, inScope, isQuizzable, isWeak } from './quiz'

function word(term: string, translation: string | undefined, context: string | undefined, extra: Partial<WordEntry> = {}): WordEntry {
  return { key: `en:${term}`, language: 'en', term, translation, context, status: 'learning', createdAt: 0, updatedAt: 0, ...extra }
}

const pos = (partOfSpeech: string, lemma?: string) => ({
  explanation: { lemma: lemma ?? '', partOfSpeech, translation: '', meaning: '', grammar: '', example: '', exampleTranslation: '' },
})

const words: WordEntry[] = [
  word('lighthouse', 'deniz feneri', 'Marlow climbed the staircase of the old Lighthouse.', pos('noun', 'lighthouse')),
  word('staircase', 'merdiven', 'He climbed the spiral staircase.', pos('noun')),
  word('beetles', 'böcekler', 'Ships drift past like glowing beetles.', pos('noun', 'beetle')),
  word('whispering', 'fısıldamak', 'The darkness itself were whispering.', pos('verb', 'whisper')),
  word('stubborn', 'inatçı', 'Even a stubborn cat makes the hours feel shorter.', { status: 'known', ...pos('adjective') }),
  word('fog', undefined, 'Some nights the fog rolled in.'),
  word('keeper', undefined, undefined, { status: 'known' }),
  word('ignored', 'yok sayılan', 'An ignored word.', { status: 'ignored' }),
]

describe('scope and weak words', () => {
  it('filters by status and never includes ignored words', () => {
    expect(inScope(words[4], 'known')).toBe(true)
    expect(inScope(words[4], 'learning')).toBe(false)
    expect(inScope(words[7], 'all')).toBe(false)
  })

  it('marks words right less than 70% of the time as weak', () => {
    expect(isWeak(word('a', 'b', 'c', { quiz: { correct: 1, wrong: 2, lastAt: 0 } }))).toBe(true)
    expect(isWeak(word('a', 'b', 'c', { quiz: { correct: 9, wrong: 1, lastAt: 0 } }))).toBe(false)
    expect(isWeak(word('a', 'b', 'c'))).toBe(false)
  })

  it('needs a translation or a usable sentence to ask about a word', () => {
    expect(isQuizzable(words[5])).toBe(true)
    expect(isQuizzable(words[6])).toBe(false)
  })
})

describe('clozeParts', () => {
  it.each([
    ['ar', 'كتاب', 'كِتَابٌ'],
    ['he', 'ספר', 'סֵפֶר'],
  ])('preserves vowel marks in %s cloze questions without needing AI', (language, term, surface) => {
    const entry = word(term, undefined, '😀 ' + surface + '.', { language })
    expect(clozeParts(entry)).toEqual({ before: '😀 ', surface, after: '.' })
    expect(buildQuiz([entry], [entry], 1)[0]?.kind).toBe('cloze')
    expect(checkTyped(surface, [term], language)).toBe('correct')
  })

  it('keeps the original casing and matches whole words only', () => {
    expect(clozeParts(words[0])).toEqual({ before: 'Marlow climbed the staircase of the old ', after: '.', surface: 'Lighthouse' })
    expect(clozeParts(word('cat', 'kedi', 'The category is wrong.'))).toBeUndefined()
  })

  it('handles letters outside ASCII', () => {
    expect(clozeParts(word('für', 'için', 'Das ist für dich.'))?.surface).toBe('für')
  })
})

describe('buildQuiz', () => {
  it('only produces valid questions and mixes all four kinds', () => {
    const kinds = new Map<string, number>()
    const targets = words.filter((w) => inScope(w, 'all'))
    for (let run = 0; run < 200; run++) {
      const quiz = buildQuiz(targets, words, 10)
      expect(quiz).toHaveLength(6) // "keeper" has no data and "ignored" is out of scope
      for (const question of quiz) {
        kinds.set(question.kind, (kinds.get(question.kind) ?? 0) + 1)
        if ('options' in question && question.options) {
          expect(question.options).toHaveLength(4)
          expect(new Set(question.options).size).toBe(4)
          expect(question.options).toContain(question.answer)
        }
        if (question.word.term === 'fog') expect(question.kind).toBe('cloze')
      }
    }
    for (const kind of ['meaning', 'reverse', 'cloze', 'typing']) expect(kinds.get(kind) ?? 0).toBeGreaterThan(50)
  })

  it('falls back to typing when there are too few words for options', () => {
    const few = [words[0], words[1]]
    for (const question of buildQuiz(few, few, 5)) {
      expect(question.kind === 'typing' || (question.kind === 'cloze' && !question.options)).toBe(true)
    }
  })

  it('accepts the lemma as a typed answer', () => {
    const quiz = buildQuiz([words[2]], [words[2]], 1, () => 0.99)
    const typing = quiz.find((question) => question.kind === 'typing')
    if (typing?.kind === 'typing') expect(typing.accepted).toEqual(['beetles', 'beetle'])
  })
})

describe('checkTyped', () => {
  it('ignores case and surrounding spaces', () => {
    expect(checkTyped('Lighthouse ', ['lighthouse'], 'en')).toBe('correct')
  })

  it('counts one typo in a longer word, or missing accents, as close', () => {
    expect(checkTyped('lighthose', ['lighthouse'], 'en')).toBe('close')
    expect(checkTyped('fur', ['für'], 'de')).toBe('close')
  })

  it('needs an exact match for short words', () => {
    expect(checkTyped('fog', ['dog'], 'en')).toBe('wrong')
    expect(checkTyped('', ['x'], 'en')).toBe('wrong')
  })

  it('uses language-aware lowercasing', () => {
    expect(checkTyped('İSTANBUL', ['istanbul'], 'tr')).toBe('correct')
  })
})

describe('phrases in tests', () => {
  const phrase = (term: string, context: string, language = 'es') =>
    ({ key: `${language}:${term}`, language, term, status: 'learning', context, createdAt: 0, updatedAt: 0 }) as WordEntry

  it('blanks out a whole phrase, whatever the spacing', () => {
    expect(clozeParts(phrase('a pesar de', 'A pesar  de la lluvia, salimos.'))).toEqual({
      before: '',
      after: ' la lluvia, salimos.',
      surface: 'A pesar  de',
    })
  })

  it('finds phrases in languages written without spaces', () => {
    expect(clozeParts(phrase('食べ て いる', '猫が魚を食べている。', 'ja'))?.surface).toBe('食べている')
  })
})
