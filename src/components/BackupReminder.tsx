import { useEffect, useState } from 'react'
import { exportBackup, lastBackupAt } from '../lib/backup'
import { useNow } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { ui } from './ui'

const SNOOZE_KEY = 'readling.backupSnooze'
const DAY = 86_400_000
const MIN_WORDS = 20

function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0
  } catch {
    return 0
  }
}

/** Everything lives in one browser, so nudge people with real progress to keep a backup. */
export function BackupReminder({ wordCount }: { wordCount: number }) {
  const t = useT()
  const now = useNow()
  const [lastBackup, setLastBackup] = useState(lastBackupAt)
  const [snooze, setSnooze] = useState(snoozedUntil)

  useEffect(() => {
    const onBackup = () => setLastBackup(lastBackupAt())
    window.addEventListener('readling:backup', onBackup)
    return () => window.removeEventListener('readling:backup', onBackup)
  }, [])

  const stale = !lastBackup || now - lastBackup > 30 * DAY
  if (wordCount < MIN_WORDS || !stale || now < snooze) return null

  function later() {
    const until = Date.now() + 7 * DAY
    setSnooze(until)
    try {
      localStorage.setItem(SNOOZE_KEY, String(until))
    } catch {
      // Shows again next time.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <p>{t('library.backupReminder', { n: wordCount })}</p>
      <div className="flex gap-2">
        <button type="button" onClick={later} className={ui.ghostButton}>
          {t('library.backupLater')}
        </button>
        <button type="button" onClick={() => void exportBackup()} className={ui.secondaryButton}>
          {t('library.backupNow')}
        </button>
      </div>
    </div>
  )
}
