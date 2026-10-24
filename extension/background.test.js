// @vitest-environment jsdom
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import source from './background.js?raw'

function setup() {
  const listeners = {}
  const stored = {}
  const chrome = {
    runtime: { id: 'extension-id', onInstalled: { addListener: (fn) => { listeners.installed = fn } }, onMessage: { addListener: (fn) => { listeners.message = fn } }, sendMessage: vi.fn(async () => ({ ok: true })), openOptionsPage: vi.fn() },
    contextMenus: { create: vi.fn(), onClicked: { addListener: (fn) => { listeners.menu = fn } } },
    action: { onClicked: { addListener: (fn) => { listeners.action = fn } }, setBadgeBackgroundColor: vi.fn(), setBadgeText: vi.fn(), setTitle: vi.fn() },
    storage: {
      sync: { get: vi.fn(async () => ({ appUrl: 'https://readling.example/app/' })) },
      session: { get: vi.fn(async (key) => key ? { [key]: stored[key] } : stored), set: vi.fn(async (entries) => Object.assign(stored, entries)), remove: vi.fn(async (keys) => keys.forEach((key) => delete stored[key])) },
    },
    tabs: { query: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
    scripting: { executeScript: vi.fn() },
  }
  const scope = { chrome, document, window, Node, location: { href: 'https://readling.example/app/#/listen' }, URL, crypto, setTimeout, clearTimeout }
  runInNewContext(source + '\n globalThis.testFunctions = { callAppLookup, showLookupPopup, lookupAppTab, rememberLookup };', scope)
  return { chrome, listeners, stored, scope, ...scope.testFunctions }
}

afterEach(() => { document.body.innerHTML = ''; document.getElementById('readling-word-popup')?.remove(); vi.restoreAllMocks() })

describe('extension isolation', () => {
  it('keeps import actions and adds the explicit selected-word action', () => {
    const { listeners, chrome } = setup()
    listeners.installed()
    expect(chrome.contextMenus.create.mock.calls.map(([value]) => value.id)).toEqual(['read-page', 'read-selection', 'explain-selection'])
  })
  it('selects only the exact configured app path and origin', async () => {
    const { chrome, lookupAppTab } = setup()
    chrome.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://readling.example/app/evil', active: true },
      { id: 2, url: 'https://evil.example/app/', active: true },
      { id: 3, url: 'https://readling.example/app/?changed=1', active: true },
      { id: 4, url: 'https://readling.example/app/#/words', active: false, lastAccessed: 100 },
      { id: 5, url: 'https://readling.example/app/#/settings', active: true, lastAccessed: 50 },
    ])
    expect((await lookupAppTab('https://readling.example/app/', { id: 9, index: 0 })).id).toBe(5)
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })
  it('does not deliver a request after the app tab changes origin or path', async () => {
    const { scope, callAppLookup } = setup()
    window.__readlingExtensionLookup = vi.fn(async () => ({ ok: true }))
    expect(await callAppLookup({}, 'https://readling.example/app/')).toEqual({ ok: true })
    scope.location.href = 'https://readling.example/app/other'
    expect(callAppLookup({}, 'https://readling.example/app/')).toBeNull()
    scope.location.href = 'https://evil.example/app/'
    expect(callAppLookup({}, 'https://readling.example/app/')).toBeNull()
    expect(window.__readlingExtensionLookup).toHaveBeenCalledTimes(1)
    delete window.__readlingExtensionLookup
  })
  it('treats all model content as text and binds Save to the isolated extension runtime', async () => {
    const { showLookupPopup, chrome } = setup()
    let shadow
    const original = Element.prototype.attachShadow
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (options) { shadow = original.call(this, options); return shadow })
    const attack = '<img src=x onerror="alert(1)">'
    showLookupPopup({ ok: true, id: 'safe-id', surface: attack, meaning: attack, language: 'en' })
    expect(shadow.textContent).toContain(attack)
    expect(shadow.querySelector('img')).toBeNull()
    expect(document.getElementById('readling-word-popup').shadowRoot).toBeNull()
    const save = [...shadow.querySelectorAll('button')].find((button) => button.textContent.includes('Save word'))
    save.click()
    await vi.waitFor(() => expect(save.textContent).toContain('Saved'))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'readling-save-word', id: 'safe-id' })
  })
  it('requires matching extension, tab and source URL before forwarding a save', async () => {
    const { chrome, listeners, rememberLookup } = setup()
    const id = '12345678-1234-1234-1234-123456789012'
    await rememberLookup(id, { sourceTabId: 2, appTabId: 3, sourceUrl: 'https://source.example/a', base: 'https://readling.example/app/', createdAt: Date.now() })
    const message = { type: 'readling-save-word', id }
    const sender = { id: 'extension-id', tab: { id: 2 }, url: 'https://source.example/a' }
    const reply = vi.fn()
    expect(listeners.message(message, { ...sender, id: 'other-extension' }, reply)).toBe(false)
    listeners.message(message, { ...sender, tab: { id: 8 } }, reply)
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false }))
    reply.mockClear()
    listeners.message(message, { ...sender, url: 'https://source.example/b' }, reply)
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false }))
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
    chrome.scripting.executeScript.mockResolvedValue([{ result: { version: 1, id, ok: true, saved: true } }])
    listeners.message(message, sender, reply)
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: true }))
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 3 }, world: 'MAIN', args: [{ version: 1, action: 'save', id }, 'https://readling.example/app/'] }))
  })
})
