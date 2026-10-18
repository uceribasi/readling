/** Languages offered for texts and explanations. Segmentation relies on Intl.Segmenter. */
export const LANGUAGES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'pt',
  'nl',
  'sv',
  'pl',
  'ru',
  'uk',
  'tr',
  'ja',
  'zh',
  'ko',
  'ar',
  'fa',
  'he',
] as const

/** Languages written right to left. */
export const RTL_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'fa', 'he'])

export function textDirection(language: string): 'rtl' | 'ltr' {
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
}

/** Languages written without spaces between words. */
export const NO_SPACE_LANGUAGES: ReadonlySet<string> = new Set(['ja', 'zh'])

/** "es-ES" → "es", if readling supports it. */
export function supportedLanguage(tag: string | undefined): string | undefined {
  const base = tag?.split(/[-_]/)[0].toLowerCase()
  return (LANGUAGES as readonly string[]).includes(base ?? '') ? base : undefined
}

const nameCache = new Map<string, Intl.DisplayNames>()

export function languageName(code: string, displayLanguage: string): string {
  try {
    let names = nameCache.get(displayLanguage)
    if (!names) {
      names = new Intl.DisplayNames([displayLanguage], { type: 'language' })
      nameCache.set(displayLanguage, names)
    }
    const name = names.of(code) ?? code
    return name.charAt(0).toLocaleUpperCase(displayLanguage) + name.slice(1)
  } catch {
    return code
  }
}

export function englishLanguageName(code: string): string {
  return languageName(code, 'en')
}
