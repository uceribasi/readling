import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { furiganaParts, japaneseAnnotations, loadAnnotator, toHiragana } from './readings'

describe('furigana', () => {
  it('converts katakana readings to hiragana', () => {
    expect(toHiragana('タベル')).toBe('たべる')
  })

  it('puts readings over kanji only, leaving okurigana alone', () => {
    expect(furiganaParts('食べる', 'タベル')).toEqual([{ text: '食', reading: 'た' }, { text: 'べる' }])
    expect(furiganaParts('引き出し', 'ヒキダシ')).toEqual([
      { text: '引', reading: 'ひ' },
      { text: 'き' },
      { text: '出', reading: 'だ' },
      { text: 'し' },
    ])
    expect(furiganaParts('ねこ', 'ネコ')).toEqual([{ text: 'ねこ' }])
  })

  it('places readings at character offsets in the sentence', () => {
    const tokens = [
      { start: 0, surface: '猫', reading: 'ネコ' },
      { start: 1, surface: 'が', reading: 'ガ' },
      { start: 2, surface: '魚', reading: 'サカナ' },
      { start: 3, surface: 'を', reading: 'ヲ' },
      { start: 4, surface: '食べ', reading: 'タベ' },
    ]
    expect(japaneseAnnotations(tokens)).toEqual([
      { start: 0, end: 1, reading: 'ねこ' },
      { start: 2, end: 3, reading: 'さかな' },
      { start: 4, end: 5, reading: 'た' },
    ])
  })
})

describe('loadAnnotator', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives pinyin per character, using the sentence for words with several readings', async () => {
    const chinese = await loadAnnotator('zh')
    const text = '我们在银行见面。'
    const annotations = chinese.annotate(text)
    expect(annotations.map((a) => text.slice(a.start, a.end))).toEqual(['我', '们', '在', '银', '行', '见', '面'])
    expect(annotations.find((a) => text.slice(a.start, a.end) === '行')?.reading).toBe('háng')
    expect(chinese.reading('银行')).toBe('yín háng')
  })

  it('tokenizes Japanese with the bundled dictionary', async () => {
    const directory = join(import.meta.dirname, '../../node_modules/kuromoji/dict')
    vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(join(directory, url.split('/').pop()!))))
    const progress: number[] = []
    const japanese = await loadAnnotator('ja', (share) => progress.push(share))
    const text = '猫が魚を食べている。'
    expect(japanese.annotate(text).map((a) => [text.slice(a.start, a.end), a.reading])).toEqual([
      ['猫', 'ねこ'],
      ['魚', 'さかな'],
      ['食', 'た'],
    ])
    expect(japanese.reading('食べている')).toBe('たべている')
    for (const text of ['😀猫が魚を食べる。', '𠮷野家で猫が魚を食べる。']) {
      const annotations = japanese.annotate(text)
      for (const [surface, reading] of [['猫', 'ねこ'], ['魚', 'さかな'], ['食', 'た']]) {
        const annotation = annotations.find((item) => item.reading === reading)!
        expect(text.slice(annotation.start, annotation.end)).toBe(surface)
      }
    }
    expect(progress.at(-1)).toBe(1)
  }, 30_000)
})
