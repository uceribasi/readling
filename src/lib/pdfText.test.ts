// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { indexTextLayer, offsetOf, rangeFor, sentenceAt, wordAt, type PageTextIndex } from './pdfText'
import { buildPhraseIndex, findTextPhrases } from './phrases'

/** Builds a fake pdf.js text layer: one span per line, <br> between lines, with chosen vertical positions. */
function layer(lines: { text: string; top: number }[]): HTMLElement {
  const root = document.createElement('div')
  lines.forEach((line, index) => {
    const span = document.createElement('span')
    span.textContent = line.text
    span.getBoundingClientRect = () => ({ top: line.top, bottom: line.top + 10, height: 10 }) as DOMRect
    root.append(span)
    if (index < lines.length - 1) root.append(document.createElement('br'))
  })
  document.body.replaceChildren(root)
  return root
}

describe('indexTextLayer', () => {
  it('never matches saved phrases across punctuation or paragraphs', () => {
    const phrases = buildPhraseIndex(['give up'])
    for (const text of ['What should I give? Up the hill lies a house.', 'Never give, up here.']) {
      const index = indexTextLayer(layer([{ text, top: 0 }]), 'en')
      expect(findTextPhrases(index.text, index.words, phrases)).toEqual([])
    }
    const index = indexTextLayer(layer([{ text: 'give', top: 0 }, { text: 'up', top: 40 }]), 'en')
    expect(findTextPhrases(index.text, index.words, phrases)).toEqual([])
  })

  it('still matches a phrase wrapped onto the next line', () => {
    const index = indexTextLayer(layer([{ text: 'Never give', top: 0 }, { text: 'up.', top: 14 }]), 'en')
    expect(findTextPhrases(index.text, index.words, buildPhraseIndex(['give up']))).toEqual([{ start: 1, end: 2, term: 'give up' }])
  })

  it('joins words hyphenated across lines', () => {
    const index = indexTextLayer(layer([{ text: 'For exam-', top: 0 }, { text: 'ple, he ignored it.', top: 14 }]), 'en')
    const example = index.words.find((word) => word.term === 'example')
    expect(example?.surface).toBe('example')
    expect(index.words.map((word) => word.term)).not.toContain('ple')
  })

  it('treats a bigger gap between lines as a paragraph break', () => {
    const index = indexTextLayer(
      layer([
        { text: 'A Running Header', top: 0 },
        { text: 'The story starts here and', top: 40 },
        { text: 'goes on.', top: 54 },
      ]),
      'en',
    )
    expect(index.text).toBe('A Running Header\n\nThe story starts here and\ngoes on.')
  })
})

describe('picking words and sentences', () => {
  let index: PageTextIndex
  // Built per run (not at collection time) so the layer is still in the document.
  beforeAll(() => {
    index = indexTextLayer(
      layer([
        { text: 'Title', top: 0 },
        { text: 'He climbed the stairs. The keeper', top: 40 },
        { text: 'smiled at him.', top: 54 },
      ]),
      'en',
    )
  })

  it('finds the word under an offset inside a text node', () => {
    const node = index.nodes[1].node
    const offset = offsetOf(index, node, node.data.indexOf('stairs') + 2)!
    expect(wordAt(index, offset)?.term).toBe('stairs')
  })

  it('returns the sentence around a word, across line breaks but not across paragraphs', () => {
    const keeper = index.words.find((word) => word.term === 'keeper')!
    expect(sentenceAt(index, keeper.start, 'en')).toBe('The keeper smiled at him.')
    const title = index.words.find((word) => word.term === 'title')!
    expect(sentenceAt(index, title.start, 'en')).toBe('Title')
  })

  it('builds a DOM range that can span several text nodes', () => {
    const start = index.text.indexOf('keeper')
    const end = index.text.indexOf('smiled') + 'smiled'.length
    expect(rangeFor(index, start, end)?.toString()).toBe('keepersmiled')
  })
})
