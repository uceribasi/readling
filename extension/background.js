// readling extension: pulls the readable text out of the current page and opens it in readling.
// Nothing is sent anywhere except to the readling tab the extension opens.

const DEFAULT_APP_URL = 'http://localhost:5173/'

async function getAppUrl() {
  const { appUrl } = await chrome.storage.sync.get('appUrl')
  return appUrl || DEFAULT_APP_URL
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'read-page', title: 'Read this page in readling', contexts: ['page'] })
  chrome.contextMenus.create({ id: 'read-selection', title: 'Read the selection in readling', contexts: ['selection'] })
  chrome.contextMenus.create({ id: 'explain-selection', title: 'Explain selected word in readling', contexts: ['selection'] })
})

chrome.action.onClicked.addListener((tab) => void sendToReadling(tab, 'auto'))
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return
  if (info.menuItemId === 'explain-selection') void explainSelection(tab, info.selectionText)
  else void sendToReadling(tab, info.menuItemId === 'read-selection' ? 'selection' : 'page')
})

/** Shows a short "!" on the toolbar button when a page can't be read (e.g. chrome:// pages). */
function flagError(tabId, message) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' })
  chrome.action.setBadgeText({ tabId, text: '!' })
  chrome.action.setTitle({ tabId, title: message })
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' })
    chrome.action.setTitle({ tabId, title: 'Read this page in readling' })
  }, 4000)
}

// Session storage survives MV3 worker suspension. These records contain routing metadata, never API keys.
const LOOKUP_PREFIX = 'readling.lookup.'

async function rememberLookup(id, entry) {
  const stored = await chrome.storage.session.get(null)
  const lookups = Object.entries(stored).filter(([key]) => key.startsWith(LOOKUP_PREFIX)).sort((a, b) => a[1].createdAt - b[1].createdAt)
  const expired = lookups.filter(([, value]) => Date.now() - value.createdAt > 5 * 60_000).map(([key]) => key)
  const retained = lookups.filter(([key]) => !expired.includes(key))
  if (retained.length >= 32) expired.push(...retained.slice(0, retained.length - 31).map(([key]) => key))
  if (expired.length) await chrome.storage.session.remove(expired)
  await chrome.storage.session.set({ [LOOKUP_PREFIX + id]: entry })
}

function readSelectionContext(surface) {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  const block = element?.closest('p,li,blockquote,figcaption,td,article,section,div') ?? element
  const body = (block?.textContent ?? surface).replace(/\s+/g, ' ').trim()
  const position = body.indexOf(surface)
  const sentence = (position < 0 ? surface : body.slice(Math.max(0, position - 600), position + surface.length + 600)).slice(0, 2_000)
  return { surface, sentence, url: location.href.slice(0, 2_048), title: document.title.slice(0, 300), language: (element?.closest('[lang]')?.lang || document.documentElement.lang || '').slice(0, 40) }
}

/** Self-contained because Chrome serializes injected functions. Only plain text enters a closed shadow root. */
function showLookupPopup(response) {
  const old = document.getElementById('readling-word-popup')
  old?.remove()
  const host = document.createElement('div')
  host.id = 'readling-word-popup'
  host.style.cssText = 'position:fixed!important;inset:20px 20px auto auto!important;z-index:2147483647!important;max-width:calc(100vw - 40px)!important;'
  const shadow = host.attachShadow({ mode: 'closed' })
  const card = document.createElement('section')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'readling word explanation')
  card.style.cssText = 'box-sizing:border-box;width:360px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);overflow:auto;padding:20px;border:1px solid #d6d3d1;border-radius:14px;background:#fff;color:#292524;box-shadow:0 12px 48px #0003;font:15px/1.5 system-ui,sans-serif;text-align:left;'
  const heading = document.createElement('div')
  heading.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:12px;'
  const name = document.createElement('strong')
  name.textContent = response.surface || 'readling'
  name.style.fontSize = '21px'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = '×'
  close.setAttribute('aria-label', 'Close explanation')
  close.style.cssText = 'border:0;background:transparent;color:#57534e;font:24px system-ui;cursor:pointer;'
  close.addEventListener('click', () => host.remove())
  heading.append(name, close)
  card.append(heading)
  const paragraph = (text, emphasis = false) => {
    if (!text) return
    const node = document.createElement('p')
    node.textContent = text
    node.dir = 'auto'
    node.style.cssText = `margin:10px 0;${emphasis ? 'font-weight:600;color:#4338ca;' : ''}`
    card.append(node)
  }
  if (response.loading) paragraph('Explaining with your readling AI settings…')
  else if (!response.ok) {
    const errors = {
      invalid: 'Select one word or a short phrase of up to 8 words, then try again.',
      busy: 'Another explanation is still running in readling. Try again when it finishes.',
      expired: 'This explanation expired. Select the word and explain it again.',
      timeout: 'The AI request timed out. Check readling and try again.',
      failed: 'Open readling and check your AI settings, then try again.',
    }
    paragraph(response.message || errors[response.error] || errors.failed)
  }
  else {
    paragraph(response.translation, true)
    paragraph(response.meaning)
    paragraph(response.grammar)
    paragraph(response.example)
    paragraph(response.exampleTranslation)
    const save = document.createElement('button')
    save.type = 'button'
    save.textContent = 'Save word to readling'
    save.style.cssText = 'margin-top:12px;border:0;border-radius:8px;padding:10px 14px;background:#4f46e5;color:white;font:600 14px system-ui;cursor:pointer;'
    save.addEventListener('click', async () => {
      save.disabled = true
      save.textContent = 'Saving…'
      try {
        const result = await chrome.runtime.sendMessage({ type: 'readling-save-word', id: response.id })
        save.textContent = result?.ok ? 'Saved to readling ✓' : 'Could not save — explain again'
      } catch { save.textContent = 'Could not save — explain again' }
    })
    card.append(save)
    paragraph(`Source language: ${response.language}`)
  }
  shadow.append(card)
  host.addEventListener('keydown', (event) => { if (event.key === 'Escape') host.remove() })
  document.documentElement.append(host)
}

function callAppLookup(request, expectedBase) {
  // Do not deliver to a tab which navigated elsewhere after it was chosen.
  const here = new URL(location.href)
  const expected = new URL(expectedBase)
  if (here.origin !== expected.origin || here.pathname !== expected.pathname || here.search !== expected.search) return null
  return typeof window.__readlingExtensionLookup === 'function' ? window.__readlingExtensionLookup(request) : null
}

async function lookupAppTab(base, sourceTab) {
  const expected = new URL(base)
  const tabs = await chrome.tabs.query({ url: `${expected.origin}/*` })
  const matching = tabs.filter((candidate) => {
    try {
      const url = new URL(candidate.url)
      return url.origin === expected.origin && url.pathname === expected.pathname && url.search === expected.search
    } catch { return false }
  }).sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
  if (matching.length) return matching[0]
  const created = await chrome.tabs.create({ url: base, active: false, index: sourceTab.index + 1, openerTabId: sourceTab.id })
  await waitForLoad(created.id, base)
  return created
}

async function appLookup(tabId, base, request) {
  // React may mount shortly after the document's load event. Retry only while the bridge is absent.
  for (let attempt = 0; attempt < 15; attempt++) {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: callAppLookup, args: [request, base] })
    if (result?.result) return result.result
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Open an up-to-date readling app before using word explanations.')
}

async function explainSelection(tab, text) {
  const surface = text?.replace(/\s+/g, ' ').trim()
  if (!tab.id || !/^https?:\/\//.test(tab.url ?? '') || !surface || surface.length > 160 || !/\p{L}/u.test(surface)) {
    flagError(tab.id, 'Select a word or short phrase (up to 160 characters) on a web page.')
    return
  }
  let request
  try {
    const [context] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readSelectionContext, args: [surface] })
    if (!context?.result) throw new Error('This page cannot be read by extensions.')
    request = { ...context.result, version: 1, action: 'explain', id: crypto.randomUUID(), createdAt: Date.now() }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showLookupPopup, args: [{ loading: true, surface }] })
    const base = (await getAppUrl()).replace(/#.*$/, '')
    const appTab = await lookupAppTab(base, tab)
    const response = await appLookup(appTab.id, base, request)
    if (response.id !== request.id || response.version !== 1) throw new Error('Unexpected readling response.')
    if (response.ok) await rememberLookup(request.id, { sourceTabId: tab.id, appTabId: appTab.id, sourceUrl: request.url, base, createdAt: request.createdAt })
    const currentTab = await chrome.tabs.get(tab.id)
    if (currentTab.url !== request.url) return
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showLookupPopup, args: [response] })
  } catch {
    flagError(tab.id, 'Could not explain this word. Check readling’s address, site permission and AI settings.')
    try {
      if ((await chrome.tabs.get(tab.id)).url !== (request?.url ?? tab.url)) return
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showLookupPopup, args: [{ ok: false, surface, message: 'Could not connect to readling. Check the extension’s Options, site permission, and your AI settings in readling.' }] })
    } catch { /* The source tab closed or revoked its activeTab permission. */ }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'readling-save-word' || sender.id !== chrome.runtime.id || typeof message.id !== 'string' || !/^[a-zA-Z0-9_-]{24,80}$/.test(message.id)) return false
  void (async () => {
    const stored = await chrome.storage.session.get(LOOKUP_PREFIX + message.id)
    const pending = stored[LOOKUP_PREFIX + message.id]
    if (!pending || sender.tab?.id !== pending.sourceTabId || sender.url !== pending.sourceUrl || Date.now() - pending.createdAt > 5 * 60_000) return sendResponse({ ok: false })
    const response = await appLookup(pending.appTabId, pending.base, { version: 1, action: 'save', id: message.id })
    sendResponse({ ok: response?.id === message.id && response?.ok === true && response?.saved === true })
  })().catch(() => sendResponse({ ok: false }))
  return true
})

async function extract(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['vendor/Readability.js', 'extract.js'],
  })
  return injection?.result
}

/** Resolves once the tab has finished loading `url` (a new tab first reports about:blank as complete). */
function waitForLoad(tabId, url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('readling took too long to open'))
    }, 20000)
    function listener(id, _info, tab) {
      if (id !== tabId || tab.status !== 'complete' || !tab.url?.startsWith(url)) return
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
    // It may have finished loading before the listener was added.
    chrome.tabs.get(tabId).then((tab) => listener(tabId, {}, tab))
  })
}

/** Runs in the readling tab: leaves the text where readling's import page picks it up. */
function deliver(payload) {
  window.__readlingImport = payload
  window.dispatchEvent(new Event('readling:import'))
}

async function sendToReadling(tab, mode) {
  if (!tab.id || !/^https?:|^file:/.test(tab.url ?? '')) {
    flagError(tab.id, 'readling can only read web pages.')
    return
  }
  let page
  try {
    page = await extract(tab.id)
  } catch {
    flagError(tab.id, 'This page can’t be read by extensions.')
    return
  }
  const useSelection = mode === 'selection' || (mode === 'auto' && page?.selection.length >= 40)
  const text = (useSelection ? page?.selection : page?.article) || page?.selection || ''
  if (!text.trim()) {
    flagError(tab.id, 'No readable text found on this page.')
    return
  }

  const base = (await getAppUrl()).replace(/#.*$/, '')
  const appTab = await chrome.tabs.create({ url: `${base}#/import`, index: tab.index + 1, openerTabId: tab.id })
  try {
    await waitForLoad(appTab.id, base)
    await chrome.scripting.executeScript({
      target: { tabId: appTab.id },
      world: 'MAIN',
      func: deliver,
      args: [{ title: page.title, text, url: page.url, lang: page.lang }],
    })
  } catch {
    // Usually a custom readling address the extension hasn't been allowed to open yet.
    chrome.runtime.openOptionsPage()
  }
}
