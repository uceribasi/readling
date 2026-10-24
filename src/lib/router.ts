import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'read'; id: number; page?: number }
  | { name: 'daily' }
  | { name: 'listen' }
  | { name: 'review' }
  | { name: 'words' }
  | { name: 'quiz'; language?: string; textId?: number }
  | { name: 'settings' }
  | { name: 'stats' }
  | { name: 'import' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const [pathname, search] = path.split('?')
  const query = new URLSearchParams(search)
  const [section, param] = pathname.split('/')
  switch (section) {
    case 'new':
      return { name: 'new' }
    case 'daily': return { name: 'daily' }
    case 'listen': return { name: 'listen' }
    case 'read': {
      const id = Number(param)
      const page = Number(query.get('page'))
      return Number.isSafeInteger(id) && id > 0 ? { name: 'read', id, ...(query.has('page') && Number.isSafeInteger(page) && page >= 0 ? { page } : {}) } : { name: 'library' }
    }
    case 'review':
      return { name: 'review' }
    case 'words':
      return { name: 'words' }
    case 'quiz': {
      const textId = Number(query.get('text'))
      return { name: 'quiz', language: param || undefined, ...(Number.isSafeInteger(textId) && textId > 0 ? { textId } : {}) }
    }
    case 'settings':
      return { name: 'settings' }
    case 'stats':
      return { name: 'stats' }
    case 'import':
      return { name: 'import' }
    default:
      return { name: 'library' }
  }
}

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseHash(hash)
}

export function navigate(path: string): void {
  window.location.hash = path
}
