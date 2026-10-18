import { describe, expect, it } from 'vitest'
import { UI_LOCALES } from '../lib/locales'
import { en } from './en'

const localeModules = import.meta.glob<Record<string, Record<string, string>>>('./*.ts')

// Plain {name} placeholders and {name, plural, …} forms.
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)[},]/g)].map((match) => match[1]))].sort()

describe.each(Object.keys(UI_LOCALES).filter((code) => code !== 'en'))('%s interface strings', (code) => {
  it('have every English key, with the same placeholders', async () => {
    const messages = (await localeModules['./' + code + '.ts']())[code]
    expect(Object.keys(messages)).toEqual(Object.keys(en))
    for (const [key, text] of Object.entries(en)) {
      expect.soft(placeholders(messages[key]), `${code}: ${key}`).toEqual(placeholders(text))
      expect.soft(messages[key].trim(), `${code}: ${key}`).not.toBe('')
    }
  })
})

describe('formatMessage', () => {
  it('picks plural forms by the language’s rules', async () => {
    const { formatMessage } = await import('../lib/i18n')
    const template = 'Best: {n, plural, one {# day} other {# days}}.'
    expect(formatMessage(template, { n: 1 }, 'en')).toBe('Best: 1 day.')
    expect(formatMessage(template, { n: 12 }, 'en')).toBe('Best: 12 days.')
    expect(formatMessage('{n} words · {m, plural, one {# new} other {# new ones}}', { n: '1,678', m: '1' }, 'en')).toBe('1,678 words · 1 new')
  })
})
