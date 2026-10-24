import { createBackup, mergeBackup } from './backup'
import { parseBackup, type Backup } from './backupValidation'

export interface SyncConnection { endpoint: string; username: string; password: string; passphrase: string }
export type SyncErrorCode = 'url' | 'passphrase' | 'crypto' | 'decrypt' | 'format' | 'size' | 'auth' | 'network' | 'etag' | 'conflict'
export class SyncError extends Error { code: SyncErrorCode; constructor(code: SyncErrorCode) { super(code); this.code = code } }
interface Envelope { app: 'readling-encrypted'; version: 1; salt: string; iv: string; data: string }
const ITERATIONS = 600_000
const MAX_BYTES = 100 * 1024 * 1024
const encoder = new TextEncoder()

export function validateEndpoint(input: string): string {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new SyncError('url') }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.hash) throw new SyncError('url')
  return url.href
}

function base64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(raw)
}
function bytes(text: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new SyncError('format')
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}
async function key(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new SyncError('crypto')
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function encryptBackup(backup: Backup, passphrase: string): Promise<string> {
  if (passphrase.length < 12) throw new SyncError('passphrase')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = encoder.encode(JSON.stringify(backup))
  if (data.length > MAX_BYTES * 0.7) throw new SyncError('size')
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(passphrase, salt), data)
  return JSON.stringify({ app: 'readling-encrypted', version: 1, salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(encrypted)) } satisfies Envelope)
}
export async function decryptBackup(input: string, passphrase: string): Promise<Backup> {
  if (input.length > MAX_BYTES) throw new SyncError('size')
  let value: Envelope
  try { value = JSON.parse(input) } catch { throw new SyncError('format') }
  if (!value || value.app !== 'readling-encrypted' || value.version !== 1 || typeof value.salt !== 'string' || typeof value.iv !== 'string' || typeof value.data !== 'string') throw new SyncError('format')
  const salt = bytes(value.salt), iv = bytes(value.iv), data = bytes(value.data)
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new SyncError('format')
  const secret = await key(passphrase, salt)
  let plain: ArrayBuffer
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, secret, data) } catch { throw new SyncError('decrypt') }
  try { return parseBackup(JSON.parse(new TextDecoder().decode(plain))) } catch { throw new SyncError('format') }
}

async function boundedText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new SyncError('size')
  if (!response.body) return ''
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let result = '', size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel(); throw new SyncError('size') }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } finally { reader.releaseLock() }
}

/** A remote write always uses a strong ETag or an absent-file precondition. */
export async function syncWithServer(connection: SyncConnection, signal?: AbortSignal): Promise<void> {
  const endpoint = validateEndpoint(connection.endpoint)
  if (connection.passphrase.length < 12) throw new SyncError('passphrase')
  if (!crypto?.subtle) throw new SyncError('crypto')
  const headers: Record<string, string> = {}
  if (connection.username || connection.password) headers.Authorization = `Basic ${base64(encoder.encode(`${connection.username}:${connection.password}`))}`
  const options: RequestInit = { headers, credentials: 'omit', redirect: 'error', cache: 'no-store', signal }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(endpoint, options)
      if ([401, 403].includes(response.status)) throw new SyncError('auth')
      if (!response.ok && response.status !== 404) throw new SyncError('network')
      const etag = response.headers.get('etag')
      if (response.ok) {
        if (!etag || !/^"[^"\r\n]*"$/.test(etag)) throw new SyncError('etag')
        const backup = await decryptBackup(await boundedText(response), connection.passphrase)
        signal?.throwIfAborted()
        await mergeBackup(backup)
      }
      signal?.throwIfAborted()
      const body = await encryptBackup(await createBackup(), connection.passphrase)
      signal?.throwIfAborted()
      const uploaded = await fetch(endpoint, { ...options, method: 'PUT', body, headers: { ...headers, 'Content-Type': 'application/json', ...(response.status === 404 ? { 'If-None-Match': '*' } : { 'If-Match': etag! }) } })
      if (uploaded.status === 412) continue
      if ([401, 403].includes(uploaded.status)) throw new SyncError('auth')
      if (!uploaded.ok) throw new SyncError('network')
      return
    }
    throw new SyncError('conflict')
  } catch (error) {
    if (error instanceof SyncError || signal?.aborted) throw error
    throw new SyncError('network')
  }
}

export interface SyncState { status: 'idle' | 'syncing' | 'done' | 'error'; error?: SyncErrorCode; lastAt?: number; automatic: boolean }
let state: SyncState = { status: 'idle', automatic: false }
let connection: SyncConnection | null = null
let active: AbortController | null = null
let interval: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
export const getSyncState = () => state
export const subscribeSync = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function publish(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()) }
export function stopSync() {
  active?.abort(); active = null; connection = null
  clearInterval(interval); interval = undefined
  publish({ status: 'idle', automatic: false, error: undefined })
}
export async function runSync(input: SyncConnection, automatic = false): Promise<void> {
  if (active) return
  clearInterval(interval); interval = undefined
  connection = { ...input }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  active = controller
  publish({ status: 'syncing', error: undefined, automatic: false })
  try {
    await syncWithServer(input, controller.signal)
    if (controller.signal.aborted) return
    publish({ status: 'done', lastAt: Date.now(), automatic })
    clearInterval(interval)
    if (automatic) interval = setInterval(() => {
      if (connection && !active && navigator.onLine && document.visibilityState === 'visible') void runSync(connection, true)
    }, 5 * 60_000)
  } catch (error) {
    if (active === controller && connection) publish({ status: 'error', error: error instanceof SyncError ? error.code : 'network' })
  } finally {
    clearTimeout(timeout)
    if (active === controller) active = null
  }
}
