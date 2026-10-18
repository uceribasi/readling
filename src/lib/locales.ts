/** Interface languages, with their names as speakers write them. */
export const UI_LOCALES = { en: 'English', tr: 'Türkçe', es: 'Español', de: 'Deutsch', pt: 'Português' } as const
export type UiLocale = keyof typeof UI_LOCALES

export function isUiLocale(code: string): code is UiLocale {
  return code in UI_LOCALES
}
