// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../lib/db'
import { updateSettings } from '../lib/settings'
import { ListeningPage } from './ListeningPage'

let root: Root
let container: HTMLDivElement
const source = '1\n00:00:01,000 --> 00:00:02,000\nCat sleeps.\n\n2\n00:00:03,000 --> 00:00:04,000\nDog plays.'

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  let index = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:media-${++index}`), revokeObjectURL: vi.fn() }))
  await db.delete()
  await db.open()
  updateSettings({ uiLanguage: 'en', lastTextLanguage: 'en', provider: 'anthropic', apiKeys: {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<ListeningPage />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
  expect(found, label).toBeDefined()
  return found!
}

async function upload(selector: string, file: File) {
  const input = container.querySelector(selector) as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

function subtitles(body = source): File {
  const file = new File([body], 'Practice.srt', { type: 'application/x-subrip' })
  Object.defineProperty(file, 'text', { value: async () => body })
  return file
}

async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    check()
  })
}

it('imports subtitles, learns a clicked word, and saves only the transcript in the library', async () => {
  await upload('#subtitle-file', subtitles())
  expect(container.textContent).toContain('2 sentences')
  await act(async () => button('Cat').click())
  await settle(() => expect(container.textContent).toContain('Learning'))
  expect(await db.words.get('en:cat')).toMatchObject({ status: 'learning', context: 'Cat sleeps.' })
  await act(async () => button('Save transcript to library').click())
  await settle(() => expect(container.textContent).toContain('Transcript saved'))
  expect(await db.texts.toArray()).toEqual([expect.objectContaining({ title: 'Practice', language: 'en', content: 'Cat sleeps.\n\nDog plays.', kind: 'text' })])
  expect(await db.files.count()).toBe(0)
})

it('preserves the current transcript when a replacement is invalid', async () => {
  await upload('#subtitle-file', subtitles())
  await upload('#subtitle-file', subtitles('not subtitles'))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be read')
  expect(container.textContent).toContain('Cat')
  expect(container.textContent).toContain('Dog')
})

it('hides the transcript in dictation and releases object URLs when media changes or the screen closes', async () => {
  await upload('#subtitle-file', subtitles())
  await upload('#listening-media', new File(['audio'], 'first.mp3', { type: 'audio/mpeg' }))
  expect(container.querySelector('audio')?.getAttribute('src')).toBe('blob:media-1')
  await act(async () => button('Dictation').click())
  expect(container.querySelector('ol')).toBeNull()
  expect(container.textContent).not.toContain('Cat sleeps.')
  expect(container.querySelector('textarea')).not.toBeNull()
  await upload('#listening-media', new File(['audio'], 'second.mp3', { type: 'audio/mpeg' }))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-1')
  expect(await db.files.count()).toBe(0)
  await act(async () => root.unmount())
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-2')
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  root = createRoot(container)
})

it('loops at the selected cue boundary and stops dictation at its end', async () => {
  let frame: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
  await upload('#subtitle-file', subtitles())
  await upload('#listening-media', new File(['audio'], 'first.mp3', { type: 'audio/mpeg' }))
  const element = container.querySelector('audio')!
  const loop = container.querySelector('input[type="checkbox"]') as HTMLInputElement
  await act(async () => loop.click())
  expect(element.currentTime).toBe(1)
  element.currentTime = 2.02
  await act(async () => frame!(0))
  expect(element.currentTime).toBe(1)
  await act(async () => loop.click())
  await act(async () => button('Dictation').click())
  vi.mocked(HTMLMediaElement.prototype.pause).mockClear()
  element.currentTime = 2.02
  await act(async () => frame!(0))
  expect(element.currentTime).toBe(2)
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
  root = createRoot(container)
})
