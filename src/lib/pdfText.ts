import { normalizeTerm } from './tokenize'

/**
 * A pdf.js text layer flattened into one string, so words and sentences can be
 * found even when the PDF splits them across several spans or lines.
 */
export interface PageTextIndex {
  text: string
  /** Text nodes in reading order with their offset in `text`. */
  nodes: { node: Text; start: number }[]
  words: PageWord[]
}

export interface PageWord {
  start: number
  end: number
  /** As printed, with line-break hyphens removed. */
  surface: string
  term: string
}

const LETTER = /\p{L}/u
const LINE_BREAK_HYPHEN = /^-\n(?=\p{Ll})/u

/**
 * Line breaks become "\n"; a clearly bigger gap between lines (a new paragraph,
 * or a heading above the text) becomes "\n\n" so sentences never cross it.
 */
export function indexTextLayer(layer: HTMLElement, language: string): PageTextIndex {
  type Piece = { node: Text; rect: DOMRect } | 'br'
  const pieces: Piece[] = []
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && node.parentElement) pieces.push({ node, rect: node.parentElement.getBoundingClientRect() })
    else if (node instanceof HTMLBRElement) pieces.push('br')
  }

  let text = ''
  const nodes: PageTextIndex['nodes'] = []
  pieces.forEach((piece, i) => {
    if (piece !== 'br') {
      nodes.push({ node: piece.node, start: text.length })
      text += piece.node.data
      return
    }
    const before = pieces.slice(0, i).findLast((candidate) => candidate !== 'br')
    const after = pieces.slice(i + 1).find((candidate) => candidate !== 'br')
    const paragraphBreak =
      before !== undefined &&
      after !== undefined &&
      (after.rect.top < before.rect.top - 1 || after.rect.top - before.rect.bottom > before.rect.height * 0.8)
    text += paragraphBreak ? '\n\n' : '\n'
  })
  return { text, nodes, words: findWords(text, language) }
}

function findWords(text: string, language: string): PageWord[] {
  const words: PageWord[] = []
  const segments = Array.from(new Intl.Segmenter(language, { granularity: 'word' }).segment(text))
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (!segment.isWordLike || !LETTER.test(segment.segment)) continue
    let end = segment.index + segment.segment.length
    let surface = segment.segment
    // Re-join words hyphenated at the end of a line: "exam-" + "ple".
    if (LINE_BREAK_HYPHEN.test(text.slice(end))) {
      const next = segments.find((candidate) => candidate.index === end + 2)
      if (next?.isWordLike) {
        surface += next.segment
        end = next.index + next.segment.length
        i = segments.indexOf(next)
      }
    }
    words.push({ start: segment.index, end, surface, term: normalizeTerm(surface, language) })
  }
  return words
}

/** Converts a position inside a text node of the layer to an offset in `index.text`. */
export function offsetOf(index: PageTextIndex, node: Node, offset: number): number | undefined {
  const entry = index.nodes.find((candidate) => candidate.node === node)
  return entry ? entry.start + offset : undefined
}

export function wordAt(index: PageTextIndex, offset: number): PageWord | undefined {
  return index.words.find((word) => offset >= word.start && offset < word.end)
}

/** The sentence around `offset`, within its paragraph, with line breaks turned back into spaces. */
export function sentenceAt(index: PageTextIndex, offset: number, language: string): string {
  const paragraphStart = index.text.lastIndexOf('\n\n', offset)
  const start = paragraphStart === -1 ? 0 : paragraphStart + 2
  const paragraphEnd = index.text.indexOf('\n\n', offset)
  const paragraph = index.text.slice(start, paragraphEnd === -1 ? undefined : paragraphEnd)
  // Same length as `paragraph`, so offsets line up.
  const flat = paragraph.replace(/\n/g, ' ')
  const local = offset - start
  for (const sentence of new Intl.Segmenter(language, { granularity: 'sentence' }).segment(flat)) {
    if (local >= sentence.index && local < sentence.index + sentence.segment.length) {
      return paragraph
        .slice(sentence.index, sentence.index + sentence.segment.length)
        .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
        .replace(/\s+/g, ' ')
        .trim()
    }
  }
  return ''
}

/** A DOM Range covering `start`..`end` of the index, possibly spanning several spans. */
export function rangeFor(index: PageTextIndex, start: number, end: number): Range | undefined {
  const locate = (offset: number, preferEnd: boolean) => {
    for (let i = index.nodes.length - 1; i >= 0; i--) {
      const { node, start: nodeStart } = index.nodes[i]
      const inside = preferEnd ? offset > nodeStart : offset >= nodeStart
      if (inside && offset <= nodeStart + node.data.length) return { node, offset: offset - nodeStart }
    }
    return undefined
  }
  const from = locate(start, false)
  const to = locate(end, true)
  if (!from || !to || !from.node.isConnected || !to.node.isConnected) return undefined
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

/** The text node and offset under a point, using whichever caret API the browser has. */
export function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : undefined
  }
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined
}
