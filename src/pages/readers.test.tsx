// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, dayKey, setWordStatus, type TextDoc } from '../lib/db'
import { updateSettings } from '../lib/settings'
import { TextReader } from './TextReader'
import { PdfReader } from './PdfReader'
import { LibraryPage } from './LibraryPage'

const mocks = vi.hoisted(() => ({ cleanup: vi.fn(), pages: 1 }))
vi.mock('../lib/pdf', () => ({
  openPdfDocument: async () => ({
    numPages: mocks.pages,
    loadingTask: { destroy: vi.fn() },
    getPage: async () => ({
      getViewport: () => ({ width: 600, height: 800, userUnit: 1 }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      streamTextContent: vi.fn(),
      cleanup: mocks.cleanup,
    }),
  }),
  loadPdfjs: async () => ({
    TextLayer: class {
      container: HTMLElement
      constructor({ container }: { container: HTMLElement }) { this.container = container }
      async render() {
        const span = document.createElement('span')
        span.textContent = 'Cat.'
        this.container.append(span)
      }
      cancel() {}
    },
  }),
}))

let root: Root
let container: HTMLDivElement
const observers: { callback: IntersectionObserverCallback; target?: Element }[] = []

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 860 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver) }
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    entry: (typeof observers)[number]
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback }; observers.push(this.entry) }
    observe(target: Element) { this.entry.target = target }
    disconnect() {}
  })
  observers.length = 0
  mocks.cleanup.mockClear()
  mocks.pages = 1
  await db.delete()
  await db.open()
  updateSettings({ uiLanguage: 'en', showReadings: false })
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

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(label))
  expect(found, label).toBeDefined()
  return found!
}

const text = (id: number, content: string, extra: Partial<TextDoc> = {}): TextDoc => ({
  id, content, title: 'Test text', language: 'en', kind: 'text', createdAt: 1, updatedAt: 1, ...extra,
})

describe('reader completion', () => {
  it('pairs a cached explanation with its source sentence when reopening a word', async () => {
    const sentence = 'We sat on the river bank.'
    updateSettings({ explanationLanguage: 'tr' })
    await setWordStatus('en', 'bank', 'learning', 'She deposited money at the bank.')
    const data = { lemma: 'bank', partOfSpeech: 'noun', translation: 'nehir kıyısı', meaning: '', grammar: '', example: '', exampleTranslation: '' }
    await db.explanations.put({ key: 'en|tr|bank|' + sentence, data, createdAt: 1 })
    await act(async () => root.render(<TextReader text={text(105, sentence)} />))
    await act(async () => (container.querySelector('[data-word="5"]') as HTMLElement).click())
    await settle(() => expect(container.textContent).toContain('nehir kıyısı'))
    expect(await db.words.get('en:bank')).toMatchObject({ context: sentence, translation: 'nehir kıyısı' })
  })

  it('finishing the last page leaves skipped pages untracked', async () => {
    const doc = text(101, 'Alpha. '.repeat(350) + '\n\n' + 'Omega. '.repeat(350), { readingPage: 1 })
    await act(async () => root.render(<TextReader text={doc} />))
    await act(async () => button('Finished this page').click())
    await settle(() => expect(container.textContent).toContain('recorded as read'))
    expect(await db.words.get('en:alpha')).toBeUndefined()
    expect((await db.words.get('en:omega'))?.status).toBe('known')
    expect((await db.activity.get(dayKey()))?.wordsRead).toBe(350)
  })

  it('records reading an already-known single-page text', async () => {
    await setWordStatus('en', 'cat', 'known')
    await act(async () => root.render(<TextReader text={text(102, 'Cat.')} />))
    await settle(() => { button('Mark this page as read') })
    await act(async () => button('Mark this page as read').click())
    await settle(() => expect(container.textContent).toContain('recorded as read'))
    expect((await db.activity.get(dayKey()))?.wordsRead).toBe(1)
  })

  it('records a known PDF page and releases its canvas when it leaves view', async () => {
    await setWordStatus('en', 'cat', 'known')
    await db.files.put({ id: 'pdf', name: 'test.pdf', type: 'application/pdf', blob: new Blob(), createdAt: 1 })
    await act(async () => root.render(<PdfReader text={text(103, '', { kind: 'pdf', fileId: 'pdf' })} />))
    await settle(() => expect(observers.length).toBe(1))
    const observer = observers[0]
    const visibility = (isIntersecting: boolean) => observer.callback([{ target: observer.target, isIntersecting }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    await act(async () => visibility(true))
    await settle(() => expect(container.querySelector('canvas')).not.toBeNull())
    await settle(() => { button('Mark this page as read') })
    await act(async () => button('Mark this page as read').click())
    await settle(() => expect(container.textContent).toContain('recorded as read'))
    expect((await db.activity.get(dayKey()))?.wordsRead).toBe(1)
    const canvas = container.querySelector('canvas')!
    await act(async () => visibility(false))
    expect(container.querySelector('canvas')).toBeNull()
    expect(canvas.width).toBe(0)
    expect(mocks.cleanup).toHaveBeenCalled()
    await act(async () => visibility(true))
    await settle(() => expect(container.querySelector('.textLayer')?.textContent).toBe('Cat.'))
  })
})

it('updates library progress when vocabulary changes outside the reader', async () => {
  await db.texts.add(text(104, 'Cat dog.', { progress: { known: 0, learning: 0, total: 2 } }))
  await act(async () => root.render(<LibraryPage />))
  await settle(() => expect(container.querySelector('ul.grid a[href="#/read/104"]')?.closest('li')?.textContent).toContain('0%'))
  await act(async () => { await setWordStatus('en', 'cat', 'known') })
  await settle(() => expect(container.querySelector('ul.grid a[href="#/read/104"]')?.closest('li')?.textContent).toContain('50%'))
})


it('restores a PDF to its saved zero-based page and persists page navigation', async () => {
  mocks.pages = 3
  const saved = text(108, '', { kind: 'pdf', fileId: 'resume-pdf', pageCount: 3, readingPage: 1 })
  await db.texts.add(saved)
  await db.files.put({ id: 'resume-pdf', name: 'resume.pdf', type: 'application/pdf', blob: new Blob(), createdAt: 1 })
  await act(async () => root.render(<PdfReader text={saved} />))
  await settle(() => expect(container.querySelectorAll('[data-pdf-page]')).toHaveLength(3))
  const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView)
  expect(scroll.mock.contexts.some((element) => (element as HTMLElement).dataset.pdfPage === '1')).toBe(true)
  const target = observers.find((observer) => (observer.target as HTMLElement)?.dataset.pdfPage === '1')!
  await act(async () => target.callback([{ target: target.target, isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  await settle(() => expect(container.querySelector('[data-pdf-page="1"] canvas')).not.toBeNull())
  const pageInput = container.querySelector<HTMLInputElement>('input[type="number"]')!
  expect(pageInput.value).toBe('2')
  await act(async () => { pageInput.value = '3'; pageInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  await settle(() => expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('3'))
  expect((await db.texts.get(saved.id))?.readingPage).toBe(2)
  expect((await db.texts.get(saved.id))?.updatedAt).toBeGreaterThan(1)
})

it('saves a page bookmark and keeps it after reopening the reader', async () => {
  const saved = text(109, 'A small story.')
  await db.texts.add(saved)
  await act(async () => root.render(<TextReader text={saved} />))
  await act(async () => button('Reading tools').click())
  await act(async () => button('Bookmark this page').click())
  await settle(() => expect(container.textContent).toContain('Saved'))
  const created = (await db.texts.get(saved.id))?.bookmarks?.[0]
  expect(created).toMatchObject({ page: 0, label: 'Page 1 of 1', note: '' })
  expect(created?.updatedAt).toBe(created?.createdAt)
  await act(async () => root.render(<div />))
  await act(async () => root.render(<TextReader text={saved} />))
  await act(async () => button('Reading tools').click())
  await settle(() => { button('Page 1 of 1') })
  await act(async () => button('Remove').click())
  await settle(() => expect(container.textContent).toContain('Save a page and add your own notes.'))
  const removed = await db.texts.get(saved.id)
  expect(removed?.bookmarks).toEqual([])
  expect(removed?.bookmarkDeletions).toEqual([{ id: created?.id, deletedAt: removed?.updatedAt }])
})


it('preserves bookmark identity, creation time and independent notes when editing', async () => {
  const saved = text(110, 'A short story.', { bookmarks: [
    { id: 'first-note', page: 0, label: 'Original', note: 'Remember this', createdAt: 10, updatedAt: 20 },
    { id: 'other-device', page: 0, label: 'Other device', note: 'Keep this too', createdAt: 15, updatedAt: 25 },
  ], bookmarkDeletions: [{ id: 'removed-elsewhere', deletedAt: 30 }] })
  await db.texts.add(saved)
  await act(async () => root.render(<TextReader text={saved} />))
  await act(async () => button('Reading tools').click())
  await settle(() => { button('Original') })
  await act(async () => button('Edit').click())
  await act(async () => button('Save changes').click())
  await settle(() => expect(container.textContent).toContain('Saved'))
  const updated = await db.texts.get(saved.id)
  expect(updated?.bookmarks?.find((bookmark) => bookmark.id === 'first-note')).toMatchObject({ createdAt: 10, updatedAt: updated?.updatedAt, note: 'Remember this' })
  expect(updated?.bookmarks?.find((bookmark) => bookmark.id === 'other-device')).toEqual(saved.bookmarks![1])
  expect(updated?.bookmarkDeletions).toEqual(saved.bookmarkDeletions)
})
