/**
 * Readings shown above words: furigana for Japanese (kuromoji.js with its IPADIC dictionary)
 * and pinyin for Chinese (pinyin-pro). Both load only when someone turns readings on.
 */

/** A reading for the characters from `start` to `end` of a sentence. */
export interface Annotation {
  start: number
  end: number
  reading: string
}

export interface Annotator {
  /** Readings for the parts of a sentence that need one (kanji, hanzi). */
  annotate(text: string): Annotation[]
  /** The whole reading of a word or phrase, for the word panel. */
  reading(text: string): string
}

export const READING_LANGUAGES: ReadonlySet<string> = new Set(['ja', 'zh'])

const KANJI = /[\p{Script=Han}々〆ヵヶ]/u

export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

/**
 * Splits a word's reading over its kanji, leaving kana as they are:
 * 食べる + たべる → 食(た)べる; 引き出し + ひきだし → 引(ひ)き出(だ)し.
 */
export function furiganaParts(surface: string, reading: string): { text: string; reading?: string }[] {
  const hiragana = toHiragana(reading)
  if (!KANJI.test(surface)) return [{ text: surface }]
  // Kanji runs become groups to capture; kana must match literally.
  const runs = surface.match(/[\p{Script=Han}々〆ヵヶ]+|[^\p{Script=Han}々〆ヵヶ]+/gu) ?? [surface]
  const pattern = new RegExp(
    `^${runs.map((run) => (KANJI.test(run) ? '(.+?)' : `(${toHiragana(run).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)).join('')}$`,
    'u',
  )
  const match = pattern.exec(hiragana)
  if (!match) return [{ text: surface, reading: hiragana }]
  return runs.map((run, i) => (KANJI.test(run) ? { text: run, reading: match[i + 1] } : { text: run }))
}

/** Character offsets of each kanji run's reading, from tokens and their positions in the text. */
export function japaneseAnnotations(tokens: { start: number; surface: string; reading?: string }[]): Annotation[] {
  const annotations: Annotation[] = []
  for (const token of tokens) {
    if (!token.reading || token.reading === '*' || !KANJI.test(token.surface)) continue
    let offset = token.start
    for (const part of furiganaParts(token.surface, token.reading)) {
      if (part.reading && part.reading !== toHiragana(part.text)) {
        annotations.push({ start: offset, end: offset + part.text.length, reading: part.reading })
      }
      offset += part.text.length
    }
  }
  return annotations
}

// Gzipped IPADIC files bundled with kuromoji.js; readling serves them at <base>/kuromoji-dict/.
const DICTIONARY_FILES = [
  'base', 'check', 'tid', 'tid_pos', 'tid_map', 'cc', 'unk', 'unk_pos', 'unk_map', 'unk_char', 'unk_compat', 'unk_invoke',
] as const
/** About 17.8 MB, for the download progress. */
export const JAPANESE_DICTIONARY_BYTES = 17_791_956

async function loadDictionaryFile(name: string, onBytes: (bytes: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(`${import.meta.env.BASE_URL}kuromoji-dict/${name}.dat.gz`)
  if (!response.ok || !response.body) throw new Error(`Could not load the Japanese dictionary (${response.status})`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    onBytes(value.byteLength)
  }
  const data = new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer())
  // Some servers already undo the gzip (Content-Encoding); only decompress real gzip data.
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data.buffer
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}

async function loadJapanese(onProgress: (share: number) => void): Promise<Annotator> {
  const [{ default: DynamicDictionaries }, { default: Tokenizer }] = await Promise.all([
    import('kuromoji/src/dict/DynamicDictionaries.js'),
    import('kuromoji/src/Tokenizer.js'),
  ])
  let loaded = 0
  const buffers = await Promise.all(
    DICTIONARY_FILES.map((name) =>
      loadDictionaryFile(name, (bytes) => {
        loaded += bytes
        onProgress(Math.min(loaded / JAPANESE_DICTIONARY_BYTES, 1))
      }),
    ),
  )
  const file = Object.fromEntries(DICTIONARY_FILES.map((name, i) => [name, buffers[i]])) as Record<(typeof DICTIONARY_FILES)[number], ArrayBuffer>
  const dictionaries = new DynamicDictionaries()
    .loadTrie(new Int32Array(file.base), new Int32Array(file.check))
    .loadTokenInfoDictionaries(new Uint8Array(file.tid), new Uint8Array(file.tid_pos), new Uint8Array(file.tid_map))
    .loadConnectionCosts(new Int16Array(file.cc))
    .loadUnknownDictionaries(
      new Uint8Array(file.unk),
      new Uint8Array(file.unk_pos),
      new Uint8Array(file.unk_map),
      new Uint8Array(file.unk_char),
      new Uint32Array(file.unk_compat),
      new Uint8Array(file.unk_invoke),
    )
  const tokenizer = new Tokenizer(dictionaries)
  const tokens = (text: string) => {
    // kuromoji counts Unicode code points; DOM ranges and String.slice use UTF-16 offsets.
    const offsets: number[] = []
    let offset = 0
    for (const char of text) {
      offsets.push(offset)
      offset += char.length
    }
    return tokenizer.tokenize(text).map((token) => ({
      start: offsets[token.word_position - 1],
      surface: token.surface_form,
      reading: token.reading,
    }))
  }
  return {
    annotate: (text) => japaneseAnnotations(tokens(text)),
    reading: (text) =>
      tokens(text)
        .map((token) => (token.reading && token.reading !== '*' ? toHiragana(token.reading) : token.surface))
        .join(''),
  }
}

async function loadChinese(): Promise<Annotator> {
  const { pinyin } = await import('pinyin-pro')
  return {
    annotate(text) {
      // The whole sentence at once, so characters with several readings get the right one.
      const syllables = pinyin(text, { type: 'all' })
      const annotations: Annotation[] = []
      let offset = 0
      for (const syllable of syllables) {
        if (syllable.isZh && KANJI.test(syllable.origin)) {
          annotations.push({ start: offset, end: offset + syllable.origin.length, reading: syllable.pinyin })
        }
        offset += syllable.origin.length
      }
      return annotations
    },
    reading: (text) => pinyin(text, { type: 'array', nonZh: 'removed' }).join(' '),
  }
}

const loading = new Map<string, Promise<Annotator>>()

export function loadAnnotator(language: string, onProgress: (share: number) => void = () => {}): Promise<Annotator> {
  let annotator = loading.get(language)
  if (!annotator) {
    annotator = language === 'ja' ? loadJapanese(onProgress) : loadChinese()
    loading.set(language, annotator)
    // A failed download can be tried again.
    annotator.catch(() => loading.delete(language))
  }
  return annotator
}
