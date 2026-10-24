// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSync } from '../lib/sync'
import { SyncSettings } from './SyncSettings'

vi.mock('../lib/i18n', () => ({ useT: () => (key: string) => key, useUiLanguage: () => 'en' }))
vi.mock('../lib/sync', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/sync')>()
  const state = { status: 'idle', automatic: false }
  return { ...original, getSyncState: () => state, subscribeSync: () => () => {}, runSync: vi.fn().mockResolvedValue(undefined) }
})

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function submitEndpoint(endpoint: string) {
  await act(async () => root.render(<SyncSettings />))
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, endpoint)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

describe('sync endpoint privacy', () => {
  it('does not persist credentials embedded in an invalid endpoint', async () => {
    await submitEndpoint('https://user:private-password@example.com/backup')
    expect(localStorage.getItem('readling.syncEndpoint')).toBeNull()
  })

  it('keeps token-bearing query addresses available only for the current request', async () => {
    const endpoint = 'https://example.com/backup?token=private-token'
    localStorage.setItem('readling.syncEndpoint', 'https://example.com/previous')
    await submitEndpoint(endpoint)
    expect(localStorage.getItem('readling.syncEndpoint')).toBeNull()
    expect(runSync).toHaveBeenCalledWith(expect.objectContaining({ endpoint }), false)
  })

  it('remembers an ordinary validated endpoint', async () => {
    await submitEndpoint('https://example.com/backup')
    expect(localStorage.getItem('readling.syncEndpoint')).toBe('https://example.com/backup')
  })

  it.each(['https://user:private-password@example.com/backup', 'https://example.com/backup?token=private-token'])('removes a previously stored secret-bearing endpoint: %s', async (endpoint) => {
    localStorage.setItem('readling.syncEndpoint', endpoint)
    await act(async () => root.render(<SyncSettings />))
    expect(container.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('')
    expect(localStorage.getItem('readling.syncEndpoint')).toBeNull()
  })
})
