// Injected into the page after vendor/Readability.js. The value of the last expression is
// returned to background.js: the page's main text and the current selection, as plain paragraphs.
(() => {
  const BLOCK = new Set([
    'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure',
    'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section',
    'summary', 'table', 'td', 'th', 'tr', 'ul',
  ])
  // <rt>/<rp> hold furigana and other ruby readings, which would otherwise be read twice.
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'rt', 'rp', 'svg', 'math', 'nav', 'button', 'select', 'textarea'])

  function paragraphsOf(root) {
    const paragraphs = []
    let buffer = ''
    const flush = () => {
      const paragraph = buffer.replace(/\s+/g, ' ').trim()
      if (paragraph) paragraphs.push(paragraph)
      buffer = ''
    }
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) buffer += child.nodeValue
        if (child.nodeType !== Node.ELEMENT_NODE) continue
        const name = child.localName
        if (SKIP.has(name) || child.hidden) continue
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

  let selection = ''
  const current = window.getSelection()
  if (current && current.rangeCount && !current.isCollapsed) {
    const holder = document.createElement('div')
    for (let i = 0; i < current.rangeCount; i++) holder.append(current.getRangeAt(i).cloneContents())
    selection = paragraphsOf(holder).join('\n\n')
  }

  let article = null
  try {
    article = new Readability(document.cloneNode(true)).parse()
  } catch {
    // Not an article-like page; fall back to the whole page below.
  }
  let text = ''
  if (article && article.content) {
    text = paragraphsOf(new DOMParser().parseFromString(article.content, 'text/html').body).join('\n\n')
  }
  if (!text && document.body) text = paragraphsOf(document.body).join('\n\n')

  // "Headline | Site name": prefer the page's own headline when the title contains it.
  let title = (article && article.title) || document.title
  const headline = document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim()
  if (headline && headline.length > 3 && title.includes(headline)) title = headline

  return {
    title,
    lang: (article && article.lang) || document.documentElement.lang || '',
    url: location.href,
    selection,
    article: text.slice(0, 500000),
  }
})()
