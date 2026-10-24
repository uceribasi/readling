import { strFromU8, unzipSync } from 'fflate'

export interface EpubBook {
  title: string
  author?: string
  /** The book's own language tag, e.g. "es" or "pt-BR". */
  language?: string
  chapters: number
  /** Navigation titles and character offsets in the extracted plain text. */
  toc: { title: string; start: number }[]
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
export function paragraphsOf(root: Node, anchors?: Map<string, number>): string[] {
  const paragraphs: string[] = []
  let buffer = ''
  let flushedLength = 0
  const flush = () => {
    const paragraph = buffer.replace(/\s+/g, ' ').trim()
    if (paragraph) { paragraphs.push(paragraph); flushedLength += paragraph.length + 2 }
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
      const id = (child as Element).getAttribute('id')
      if (id && anchors) anchors.set(id, flushedLength + buffer.replace(/\s+/g, ' ').trimStart().length)
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
      filter: (entry) => /\.(xml|opf|ncx|x?html?|xht)$/i.test(entry.name),
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

  const navigation: { path: string; fragment: string; title: string }[] = []
  function addNavigation(basePath: string, href: string, title: string) {
    if (!href || !title.trim()) return
    const directory = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : ''
    let fragment = href.split('#')[1] ?? ''
    try { fragment = decodeURIComponent(fragment) } catch { /* Keep a malformed fragment as text. */ }
    navigation.push({ path: resolve(directory, href.split('#')[0] || basePath.slice(directory.length)), fragment, title: title.replace(/\s+/g, ' ').trim() })
  }
  const navItems = byName(opf, 'item').filter((item) => (item.getAttribute('properties') ?? '').split(/\s+/).includes('nav'))
  for (const item of navItems) {
    const path = manifest.get(item.getAttribute('id') ?? '')
    const nav = path ? parseXml(read(path) ?? '', 'application/xhtml+xml') : null
    if (!nav || !path) continue
    const sections = byName(nav, 'nav')
    const toc = sections.find((section) => (section.getAttribute('epub:type') ?? section.getAttribute('type') ?? '').split(/\s+/).includes('toc')) ?? sections[0]
    if (toc) for (const link of byName(toc, 'a')) addNavigation(path, link.getAttribute('href') ?? '', link.textContent ?? '')
  }
  if (!navigation.length) {
    const ncxItem = byName(opf, 'item').find((item) => item.getAttribute('media-type') === 'application/x-dtbncx+xml')
    const path = ncxItem ? manifest.get(ncxItem.getAttribute('id') ?? '') : undefined
    const ncx = path ? parseXml(read(path) ?? '') : null
    if (ncx && path) for (const point of byName(ncx, 'navPoint')) {
      addNavigation(path, byName(point, 'content')[0]?.getAttribute('src') ?? '', byName(point, 'navLabel')[0]?.textContent ?? '')
    }
  }

  let chapters = 0
  let offset = 0
  const toc: EpubBook['toc'] = []
  const paragraphs: string[] = []
  for (const path of spine) {
    const source = read(path)
    if (!source) continue
    const doc = parseXml(source, 'application/xhtml+xml') ?? new DOMParser().parseFromString(source, 'text/html')
    const body = byName(doc, 'body')[0]
    const anchors = new Map<string, number>()
    if (body?.id) anchors.set(body.id, 0)
    const chapter = body ? paragraphsOf(body, anchors) : []
    if (!chapter.length) continue
    chapters++
    const links = navigation.filter((entry) => entry.path === path && (!entry.fragment || anchors.has(entry.fragment)))
    if (links.length) {
      for (const link of links) toc.push({ title: link.title, start: offset + Math.min(anchors.get(link.fragment) ?? 0, chapter.join('\n\n').length) })
    } else {
      const heading = body && Array.from(body.querySelectorAll('h1, h2, h3')).find((element) => element.textContent?.trim())
      toc.push({ title: heading?.textContent?.replace(/\s+/g, ' ').trim() || chapter[0].slice(0, 120), start: offset })
    }
    paragraphs.push(...chapter)
    offset += chapter.join('\n\n').length + 2
  }
  if (!paragraphs.length) throw new EpubError('empty')

  const meta = (name: string) => byName(opf, name)[0]?.textContent?.trim() || undefined
  return {
    title: meta('title') ?? file.name.replace(/\.epub$/i, ''),
    author: meta('creator'),
    language: meta('language'),
    chapters,
    toc: toc.sort((a, b) => a.start - b.start).filter((entry, index, all) => !index || entry.start !== all[index - 1].start),
    text: paragraphs.join('\n\n'),
  }
}
