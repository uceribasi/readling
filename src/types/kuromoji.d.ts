// The parts of kuromoji.js that readling uses (its dictionary classes and tokenizer, loaded directly).
declare module 'kuromoji/src/dict/DynamicDictionaries.js' {
  export default class DynamicDictionaries {
    loadTrie(base: Int32Array, check: Int32Array): this
    loadTokenInfoDictionaries(tokenInfo: Uint8Array, pos: Uint8Array, targetMap: Uint8Array): this
    loadConnectionCosts(costs: Int16Array): this
    loadUnknownDictionaries(
      unk: Uint8Array,
      unkPos: Uint8Array,
      unkMap: Uint8Array,
      catMap: Uint8Array,
      compatCatMap: Uint32Array,
      invokeDef: Uint8Array,
    ): this
  }
}

declare module 'kuromoji/src/Tokenizer.js' {
  import type DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries.js'

  export interface KuromojiToken {
    /** 1-based position in the text. */
    word_position: number
    surface_form: string
    /** In katakana, or "*" when unknown. */
    reading?: string
  }

  export default class Tokenizer {
    constructor(dictionaries: DynamicDictionaries)
    tokenize(text: string): KuromojiToken[]
  }
}
