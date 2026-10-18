import { Component, type ErrorInfo, type ReactNode } from 'react'
import { exportBackup } from '../lib/backup'
import type { UiLocale } from '../lib/locales'
import { resolveUiLanguage, getSettings } from '../lib/settings'
import { ui } from './ui'

const TEXT = {
  en: {
    title: 'Something went wrong',
    body: 'This screen hit an error. Your texts and words are safe in this browser.',
    reload: 'Reload',
    backup: 'Download a backup',
    home: 'Back to the library',
  },
  tr: {
    title: 'Bir şeyler ters gitti',
    body: 'Bu ekranda bir hata oluştu. Metinlerin ve kelimelerin bu tarayıcıda güvende.',
    reload: 'Yeniden yükle',
    backup: 'Yedek indir',
    home: 'Kitaplığa dön',
  },
  es: {
    title: 'Algo salió mal',
    body: 'Esta pantalla tuvo un error. Tus textos y palabras están a salvo en este navegador.',
    reload: 'Recargar',
    backup: 'Descargar una copia de seguridad',
    home: 'Volver a la biblioteca',
  },
  de: {
    title: 'Etwas ist schiefgelaufen',
    body: 'Auf dieser Seite ist ein Fehler aufgetreten. Deine Texte und Wörter sind in diesem Browser sicher.',
    reload: 'Neu laden',
    backup: 'Sicherung herunterladen',
    home: 'Zurück zur Bibliothek',
  },
  pt: {
    title: 'Algo deu errado',
    body: 'Esta tela encontrou um erro. Seus textos e palavras estão seguros neste navegador.',
    reload: 'Recarregar',
    backup: 'Baixar um backup',
    home: 'Voltar à biblioteca',
  },
} satisfies Record<UiLocale, Record<string, string>>

interface Props {
  /** Changing this (e.g. the route) clears the error, so navigating away recovers. */
  resetKey: string
  children: ReactNode
}

/** Keeps a crash in one screen from blanking the whole app, and offers a way out. */
export class ErrorBoundary extends Component<Props, { error: Error | null; resetKey: string }> {
  state = { error: null as Error | null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: { error: Error | null; resetKey: string }) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const text = TEXT[resolveUiLanguage(getSettings().uiLanguage)]
    return (
      <div role="alert" className={`${ui.card} mx-auto flex max-w-lg flex-col gap-3 p-6`}>
        <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-50">{text.title}</h1>
        <p className={ui.muted}>{text.body}</p>
        <pre className="max-h-32 overflow-auto rounded bg-stone-100 p-2 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {this.state.error.message}
        </pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.location.reload()} className={ui.primaryButton}>
            {text.reload}
          </button>
          <button type="button" onClick={() => void exportBackup()} className={ui.secondaryButton}>
            {text.backup}
          </button>
          <a href="#/" className={ui.ghostButton}>
            {text.home}
          </a>
        </div>
      </div>
    )
  }
}
