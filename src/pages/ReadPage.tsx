import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { ui } from '../components/ui'
import { db, legacyTextId } from '../lib/db'
import { useT } from '../lib/i18n'
import { PdfReader } from './PdfReader'
import { TextReader } from './TextReader'

/** Opens a saved text in the reader that fits it: pasted text or PDF. */
export function ReadPage({ id, initialPage }: { id: number; initialPage?: number }) {
  const t = useT()
  const text = useLiveQuery(() => db.texts.get(id).then((doc) => doc ?? null), [id])

  useEffect(() => {
    if (text && !text.syncId) void db.texts.update(text.id, { syncId: legacyTextId(text) })
  }, [text])

  useEffect(() => {
    void db.texts.update(id, { lastOpenedAt: Date.now() })
  }, [id])

  if (text === undefined) return null
  if (text === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className={ui.muted}>{t('reader.notFound')}</p>
        <a href="#/" className={ui.secondaryButton}>
          ← {t('reader.back')}
        </a>
      </div>
    )
  }
  return text.kind === 'pdf' ? <PdfReader text={text} initialPage={initialPage} /> : <TextReader text={text} initialPage={initialPage} />
}
