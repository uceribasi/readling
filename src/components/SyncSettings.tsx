import { useState, useSyncExternalStore } from 'react'
import { useT, useUiLanguage } from '../lib/i18n'
import { getSyncState, runSync, stopSync, subscribeSync, validateEndpoint } from '../lib/sync'
import { ui } from './ui'

function savedEndpoint(): string {
  try {
    const value = localStorage.getItem('readling.syncEndpoint')
    if (!value) return ''
    const endpoint = validateEndpoint(value)
    if (!new URL(endpoint).search) return endpoint
  } catch { /* Invalid addresses must never retain embedded credentials. */ }
  try { localStorage.removeItem('readling.syncEndpoint') } catch { /* Storage may be unavailable. */ }
  return ''
}
export function SyncSettings() {
  const t = useT(), locale = useUiLanguage()
  const state = useSyncExternalStore(subscribeSync, getSyncState)
  const [endpoint, setEndpoint] = useState(savedEndpoint)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [automatic, setAutomatic] = useState(state.automatic)
  return <section id="sync" className={`${ui.card} space-y-4 p-5`}>
    <h2 className="text-lg font-semibold">{t('sync.title')}</h2>
    <p className={ui.muted}>{t('sync.description')}</p>
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault()
      try {
        const address = validateEndpoint(endpoint)
        // A query may contain an access token; keep those addresses in memory only.
        if (new URL(address).search) localStorage.removeItem('readling.syncEndpoint')
        else localStorage.setItem('readling.syncEndpoint', address)
      } catch { /* runSync reports validation errors; never persist invalid input. */ }
      void runSync({ endpoint, username, password, passphrase }, automatic)
    }}>
      <label className="block"><span className={ui.label}>{t('sync.endpoint')}</span><input type="url" required className={ui.input} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://cloud.example/dav/readling.json" autoComplete="off" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={ui.label}>{t('sync.username')}</span><input className={ui.input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></label>
        <label><span className={ui.label}>{t('sync.password')}</span><input type="password" className={ui.input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></label>
      </div>
      <label className="block"><span className={ui.label}>{t('sync.passphrase')}</span><input type="password" required minLength={12} className={ui.input} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" /></label>
      <p className={ui.muted}>{t('sync.secretHint')}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={automatic} onChange={(e) => { setAutomatic(e.target.checked); if (!e.target.checked) stopSync() }} />{t('sync.automatic')}</label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={state.status === 'syncing'} className={ui.primaryButton}>{t(state.status === 'syncing' ? 'sync.working' : 'sync.now')}</button>
        {(state.automatic || state.status === 'syncing') ? <button type="button" className={ui.secondaryButton} onClick={() => { stopSync(); setAutomatic(false) }}>{t('sync.stop')}</button> : null}
      </div>
    </form>
    {state.status === 'error' && state.error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t(`sync.error.${state.error}`)}</p> : null}
    {state.lastAt ? <p role="status" className={ui.muted}>{t('sync.last', { time: new Date(state.lastAt).toLocaleString(locale) })}</p> : null}
    <details className="text-sm"><summary className="cursor-pointer font-medium">{t('sync.requirements')}</summary><p className={`${ui.muted} mt-2`}>{t('sync.requirementsHint')}</p></details>
  </section>
}
