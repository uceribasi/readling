import type { ReactNode } from 'react'
import { useDueWords, useNow } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { useRoute } from '../lib/router'

export function Layout({ children }: { children: ReactNode }) {
  const t = useT()
  const route = useRoute()
  const due = useDueWords(useNow())

  const links = [
    { href: '#/', label: t('nav.library'), active: route.name === 'library' || route.name === 'new' || route.name === 'read' || route.name === 'stats' || route.name === 'import' },
    { href: '#/words', label: t('nav.words'), active: route.name === 'words' || route.name === 'quiz' },
    { href: '#/review', label: t('nav.review'), active: route.name === 'review', badge: due?.length },
    // A gear on phones, where the labels of five languages don't all fit.
    { href: '#/settings', label: t('nav.settings'), active: route.name === 'settings', icon: <GearIcon /> },
  ]

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only z-50 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('nav.skip')}
      </a>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight text-stone-900 dark:text-stone-50">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-6" />
            <span className="hidden sm:inline">readling</span>
          </a>
          <nav className="flex items-center gap-1" aria-label={t('nav.label')}>
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                aria-current={link.active ? 'page' : undefined}
                className={`relative rounded-md px-2 py-1.5 text-sm font-medium transition sm:px-3 ${
                  link.active
                    ? 'bg-stone-200/70 text-stone-900 dark:bg-stone-800 dark:text-stone-50'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'
                }`}
              >
                {link.icon ? (
                  <>
                    <span className="sm:hidden">{link.icon}</span>
                    <span className="max-sm:sr-only">{link.label}</span>
                  </>
                ) : (
                  link.label
                )}
                {link.badge ? (
                  <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                    {link.badge}
                  </span>
                ) : null}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 outline-none sm:py-8">
        {children}
      </main>
    </div>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}
