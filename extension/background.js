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
})

chrome.action.onClicked.addListener((tab) => void sendToReadling(tab, 'auto'))
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab) void sendToReadling(tab, info.menuItemId === 'read-selection' ? 'selection' : 'page')
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
