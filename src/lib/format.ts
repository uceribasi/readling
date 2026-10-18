const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
  ['month', 2_592_000_000],
  ['year', 31_536_000_000],
]

/** "in 3 days" / "3 gün sonra", using the largest unit that fits. */
export function relativeTime(target: Date, now: number, language: string): string {
  const diff = target.getTime() - now
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  let [unit, size] = UNITS[0]
  for (const [candidate, candidateSize] of UNITS) if (Math.abs(diff) >= candidateSize) [unit, size] = [candidate, candidateSize]
  return format.format(Math.round(diff / size), unit)
}

/** CSV cell with quotes escaped, safe for Excel and Anki. */
export function csvCell(value: string | undefined): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`
}

export function downloadFile(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Revoking right away can cancel the download in Firefox and Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
