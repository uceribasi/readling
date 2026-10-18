import { strFromU8, unzipSync } from 'fflate'

export interface EpubBook {
  title: string
  author?: string
  /** The book's own language tag, e.g. "es" or "pt-BR". */
  language?: string
  chapters: number
  /** Plain text, one paragraph per block, separated by blank lines. */
  text: string
}

export type EpubErrorCode = 'invalid' | 'drm' | 'empty'

export class EpubError extends Error {
  code: EpubErrorCode

  constructor(code: EpubErrorCode) {
    super(`epub-${code}`)
    this.name = 'EpubError'
    this.code = code
  }
}

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'td',
  'th', 'tr', 'ul',
])
// <rt>/<rp> hold furigana and other ruby readings, which would otherwise be read twice.
const SKIP = new Set(['head', 'script', 'style', 'rt', 'rp', 'svg', 'math', 'nav'])

/** Turns an XHTML chapter into paragraphs, one per block element. */
export function paragraphsOf(root: Node): string[] {
  const paragraphs: string[] = []
  let buffer = ''
  const flush = () => {
    const paragraph = buffer.replace(/\s+/g, ' ').trim()
    if (paragraph) paragraphs.push(paragraph)
    buffer = ''
  }
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 || child.nodeType === 4) buffer += child.nodeValue ?? ''
      if (child.nodeType !== 1) continue
      const name = (child as Element).localName.toLowerCase()
      if (SKIP.has(name)) continue
      if (name === 'br') buffer += ' '
      const block = BLOCK.has(name)
      if (block) flush()
      walk(child)
      if (block) flush()
    }
  }
  walk(root)
  flush()
  return paragraphs
}

function parseXml(source: string, type: DOMParserSupportedType = 'application/xml'): Document | null {
  const doc = new DOMParser().parseFromString(source, type)
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

/** Elements by local name, ignoring namespace prefixes like dc: and opf:. */
function byName(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter((element) => element.localName === name)
}

function resolve(base: string, href: string): string {
  const parts = (base + href.split('#')[0]).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.map((part) => decodeURIComponent(part)).join('/')
}

/** Reads the text of a DRM-free EPUB in reading order. Images and styles are skipped. */
export async function readEpub(file: File): Promise<EpubBook> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => /\.(xml|opf|x?html?|xht)$/i.test(entry.name),
    })
  } catch {
    throw new EpubError('invalid')
  }
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : undefined)

  const container = parseXml(read('META-INF/container.xml') ?? '')
  const opfPath = container && byName(container, 'rootfile')[0]?.getAttribute('full-path')
  const opf = opfPath ? parseXml(read(opfPath) ?? '') : null
  if (!opfPath || !opf) throw new EpubError('invalid')
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const manifest = new Map(
    byName(opf, 'item').map((item) => [item.getAttribute('id') ?? '', resolve(base, item.getAttribute('href') ?? '')]),
  )
  const spine = byName(opf, 'itemref')
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((path): path is string => Boolean(path))

  // Font obfuscation is common and harmless; encrypted chapters mean DRM.
  const encryption = read('META-INF/encryption.xml')
  if (encryption && spine.some((path) => encryption.includes(path.slice(base.length)) || encryption.includes(path)))
    throw new EpubError('drm')

  let chapters = 0
  const paragraphs: string[] = []
  for (const path of spine) {
    const source = read(path)
    if (!source) continue
    const doc = parseXml(source, 'application/xhtml+xml') ?? new DOMParser().parseFromString(source, 'text/html')
    const body = byName(doc, 'body')[0]
    const chapter = body ? paragraphsOf(body) : []
    if (chapter.length) chapters++
    paragraphs.push(...chapter)
  }
  if (!paragraphs.length) throw new EpubError('empty')

  const meta = (name: string) => byName(opf, name)[0]?.textContent?.trim() || undefined
  return {
    title: meta('title') ?? file.name.replace(/\.epub$/i, ''),
    author: meta('creator'),
    language: meta('language'),
    chapters,
    text: paragraphs.join('\n\n'),
  }
}
