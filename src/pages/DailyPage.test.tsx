// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dayKey, db } from '../lib/db'
import { loadDailySession } from '../lib/daily'
import { updateSettings } from '../lib/settings'
import { newCard } from '../lib/srs'
import { DailyPage } from './DailyPage'

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  await db.delete()
  await db.open()
  updateSettings({ uiLanguage: 'en', provider: 'anthropic', apiKeys: {}, lastTextLanguage: 'en' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    check()
  })
}
function button(text: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text))
  expect(found, text).toBeDefined()
  return found!
}
async function click(text: string) { await act(async () => button(text).click()) }
async function remount() {
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(<DailyPage />))
}

describe('daily guided practice', () => {
  it('resumes each stage and does not count completed reviews, reading or quiz answers again', async () => {
    const now = Date.now()
    await db.words.add({ key: 'en:cat', term: 'cat', language: 'en', translation: 'kedi', status: 'learning', card: newCard(new Date(now - 1000)), createdAt: now, updatedAt: now })
    await db.texts.add({ id: 1, syncId: 'daily-test', language: 'en', title: 'The cat', content: 'The cat sleeps.', createdAt: now, updatedAt: now })
    await act(async () => root.render(<DailyPage />))
    await settle(() => expect(container.textContent).toContain('cat'))
    await click('Show answer')
    await click('Good')
    await settle(() => expect(container.textContent).toContain('1 word reviewed'))
    expect((await db.activity.get(dayKey()))?.reviews).toBe(1)
    await click('Continue to reading')
    await settle(() => expect(container.textContent).toContain('The cat sleeps.'))
    expect(loadDailySession('en')?.stage).toBe('read')
    await remount()
    await settle(() => expect(container.textContent).toContain('The cat sleeps.'))
    await click('I’ve read this')
    await settle(() => expect(container.querySelector('#daily-answer')).not.toBeNull())
    expect((await db.activity.get(dayKey()))?.wordsRead).toBe(3)
    await remount()
    await settle(() => expect(container.querySelector('#daily-answer')).not.toBeNull())
    expect((await db.activity.get(dayKey()))?.reviews).toBe(1)
    expect((await db.activity.get(dayKey()))?.wordsRead).toBe(3)
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('#daily-answer')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'cat')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Check')
    await click('Next')
    await settle(() => expect(container.textContent).toContain('1 word practiced'))
    expect((await db.words.get('en:cat'))?.quiz?.correct).toBe(1)
    expect((await db.activity.get(dayKey()))?.quiz).toBe(1)
    await remount()
    await settle(() => expect(container.textContent).toContain('1 word practiced'))
    await click('Finish today’s session')
    await settle(() => expect(loadDailySession('en')?.stage).toBe('done'))
    expect((await db.activity.get(dayKey()))?.quiz).toBe(1)
  })

  it('handles a saved reading that was deleted and advances without inventing reading activity', async () => {
    const now = Date.now()
    await db.words.add({ key: 'en:cat', term: 'cat', language: 'en', status: 'known', createdAt: now, updatedAt: now })
    localStorage.setItem(`readling.daily.${dayKey()}.en`, JSON.stringify({ date: dayKey(), language: 'en', goal: 10, stage: 'read', reviewKeys: [], reviewedKeys: [], textId: 99, quizKeys: [], answers: [] }))
    await act(async () => root.render(<DailyPage />))
    await settle(() => expect(container.textContent).toContain('Add a plain text or EPUB'))
    await click('Continue to practice')
    await settle(() => expect(container.textContent).toContain('0 words practiced'))
    expect(await db.activity.get(dayKey())).toBeUndefined()
  })

  it('includes vocabulary saved during the reading stage in the following practice', async () => {
    const now = Date.now()
    await db.texts.add({ id: 1, syncId: 'new-vocabulary', language: 'en', title: 'The cat', content: 'The cat sleeps.', createdAt: now, updatedAt: now })
    await act(async () => root.render(<DailyPage />))
    await settle(() => expect(container.textContent).toContain('0 words reviewed'))
    await click('Continue to reading')
    await act(async () => { await db.words.add({ key: 'en:cat', term: 'cat', language: 'en', translation: 'kedi', status: 'learning', createdAt: now, updatedAt: now }) })
    await settle(() => expect(container.textContent).toContain('The cat sleeps.'))
    await click('I’ve read this')
    await settle(() => expect(container.textContent).toContain('kedi'))
    expect(loadDailySession('en')?.quizKeys).toEqual(['en:cat'])
  })
})
