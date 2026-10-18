import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'

export type PdfErrorCode = 'password' | 'invalid' | 'no-text'

export class PdfError extends Error {
  code: PdfErrorCode

  constructor(code: PdfErrorCode) {
    super(code)
    this.name = 'PdfError'
    this.code = code
  }
}

export interface PdfInfo {
  numPages: number
  /** Readable text of the first pages, shown on the library card. */
  preview: string
}

interface Line {
  text: string
  /** Baseline position; PDF coordinates grow upwards. */
  y: number
}

const SENTENCE_END = /[.!?:;…"”»)\]]$/
const PAGE_NUMBER = /^[-–—\s]*(?:page|sayfa|seite|página|p\.)?\s*\d{1,4}(?:\s*(?:\/|of|de|von)\s*\d{1,4})?[-–—\s]*$/i

/** pdf.js is large, so it's only loaded when someone actually opens a PDF. */
export async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export async function openPdfDocument(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs()
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  } catch (error) {
    throw new PdfError(error instanceof Error && error.name === 'PasswordException' ? 'password' : 'invalid')
  }
}

/** Checks that a PDF has a text layer and reads a short preview from its first pages. */
export async function inspectPdf(file: Blob): Promise<PdfInfo> {
  const doc = await openPdfDocument(file)
  try {
    const sampled = Math.min(doc.numPages, 3)
    const pages: Line[][] = []
    for (let number = 1; number <= sampled; number++) {
      const page = await doc.getPage(number)
      pages.push(toLines((await page.getTextContent()).items))
      page.cleanup()
    }
    const preview = pagesToText(dropRepeatedEdges(pages))
    // Scanned PDFs are images; they have little or no text layer.
    if (preview.replace(/\s/g, '').length < 20 * sampled) throw new PdfError('no-text')
    return { numPages: doc.numPages, preview: preview.slice(0, 2000) }
  } finally {
    void doc.loadingTask.destroy()
  }
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item
}

function toLines(items: (TextItem | TextMarkedContent)[]): Line[] {
  const lines: Line[] = []
  let text = ''
  let y: number | undefined
  const finish = () => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean && y !== undefined) lines.push({ text: clean, y })
    text = ''
    y = undefined
  }
  for (const item of items.filter(isTextItem)) {
    const itemY = item.transform[5] as number
    const size = Math.max(item.height, 1)
    // Some PDFs don't mark line ends; a clear jump in height means a new line.
    if (y !== undefined && item.str && Math.abs(itemY - y) > size * 0.5) finish()
    if (item.str) {
      y ??= itemY
      text += item.str
    }
    if (item.hasEOL) finish()
  }
  finish()
  return lines
}

/** Removes page numbers and running headers/footers that repeat across pages. */
function dropRepeatedEdges(pages: Line[][]): Line[][] {
  const normalize = (line: Line) => line.text.replace(/\d+/g, '#').toLowerCase()
  const counts = new Map<string, number>()
  for (const lines of pages) {
    const edges = new Set([lines[0], lines.at(-1)].filter(Boolean).map((line) => normalize(line!)))
    for (const edge of edges) counts.set(edge, (counts.get(edge) ?? 0) + 1)
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.3))
  const isEdgeNoise = (line: Line) => PAGE_NUMBER.test(line.text) || (counts.get(normalize(line)) ?? 0) >= threshold

  return pages.map((lines) => {
    const kept = [...lines]
    while (kept.length && isEdgeNoise(kept[0])) kept.shift()
    while (kept.length && isEdgeNoise(kept[kept.length - 1])) kept.pop()
    return kept
  })
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Rebuilds paragraphs: joins wrapped lines, fixes hyphenation and starts paragraphs at larger gaps. */
function pagesToText(pages: Line[][]): string {
  const paragraphs: string[] = []
  let current = ''

  const append = (line: string) => {
    if (!current) current = line
    // "exam-" + "ple" → "example", but keep real hyphens like "well-" + "Known".
    else if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) current = current.slice(0, -1) + line
    else current += ` ${line}`
  }
  const breakParagraph = () => {
    if (current) paragraphs.push(current)
    current = ''
  }

  for (const lines of pages) {
    const gaps = lines.slice(1).map((line, index) => lines[index].y - line.y).filter((gap) => gap > 0)
    const typicalGap = median(gaps)
    const typicalLength = median(lines.map((line) => line.text.length))

    lines.forEach((line, index) => {
      if (index > 0) {
        const previous = lines[index - 1]
        const gap = previous.y - line.y
        const biggerGap = typicalGap > 0 && gap > typicalGap * 1.45
        const shortEnding = SENTENCE_END.test(previous.text) && previous.text.length < typicalLength * 0.7
        if (biggerGap || gap < 0 || shortEnding) breakParagraph()
      } else if (current && SENTENCE_END.test(current)) {
        // A page that starts after a finished sentence starts a new paragraph.
        breakParagraph()
      }
      append(line.text)
    })
  }
  breakParagraph()
  return paragraphs.join('\n\n')
}
