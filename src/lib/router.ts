import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'read'; id: number }
  | { name: 'review' }
  | { name: 'words' }
  | { name: 'quiz'; language?: string }
  | { name: 'settings' }
  | { name: 'stats' }
  | { name: 'import' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const [section, param] = path.split('/')
  switch (section) {
    case 'new':
      return { name: 'new' }
    case 'read': {
      const id = Number(param)
      return Number.isInteger(id) && id > 0 ? { name: 'read', id } : { name: 'library' }
    }
    case 'review':
      return { name: 'review' }
    case 'words':
      return { name: 'words' }
    case 'quiz':
      return { name: 'quiz', language: param || undefined }
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
