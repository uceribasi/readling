import { useT } from '../lib/i18n'
import { canSpeak, speak } from '../lib/speech'

/** A small speaker button that reads `text` aloud. Renders nothing where speech isn't available. */
export function SpeakButton({ text, language, slow, className = '' }: { text: string; language: string; slow?: boolean; className?: string }) {
  const t = useT()
  if (!canSpeak()) return null
  const label = slow ? t('speech.sentence') : t('speech.word')
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        speak(text, language, slow ? 0.8 : 0.9)
      }}
      aria-label={label}
      title={label}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-indigo-50 hover:text-indigo-600 dark:text-stone-400 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  )
}
