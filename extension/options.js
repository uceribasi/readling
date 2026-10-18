const DEFAULT_APP_URL = 'http://localhost:5173/'
const input = document.getElementById('app-url')
const status = document.getElementById('status')

chrome.storage.sync.get('appUrl').then(({ appUrl }) => {
  input.value = appUrl || DEFAULT_APP_URL
})

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  status.className = ''
  let url
  try {
    url = new URL(input.value.trim())
    if (!/^https?:$/.test(url.protocol)) throw new Error()
  } catch {
    status.className = 'error'
    status.textContent = 'Enter an http(s) address.'
    return
  }
  // The extension needs permission to hand texts to readling at this address.
  const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] })
  if (!granted) {
    status.className = 'error'
    status.textContent = 'Permission is needed to open texts there.'
    return
  }
  await chrome.storage.sync.set({ appUrl: url.href })
  status.textContent = 'Saved.'
})
