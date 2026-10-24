// @vitest-environment jsdom
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { EpubError, readEpub } from './epub'

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>El faro</dc:title><dc:creator>Ana Ruiz</dc:creator><dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="c2" href="text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`

// jsdom's TextEncoder makes Uint8Arrays from another realm, which fflate doesn't recognize.
const strToU8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'))

const xhtml = (body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>${body}</body></html>`

function epub(extra: Record<string, string> = {}): File {
  const zip = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/text/one.xhtml': strToU8(
      xhtml('<h1>Capítulo uno</h1><p>Marlo subía la <em>escalera</em>\n cada noche.</p><p><ruby>灯<rt>とう</rt></ruby>台</p>'),
    ),
    'OEBPS/text/chapter 2.xhtml': strToU8(xhtml('<section><h2>Dos</h2><div>La luz<br/>giraba.</div></section>')),
    'OEBPS/images/cover.jpg': new Uint8Array([1, 2, 3]),
    ...Object.fromEntries(Object.entries(extra).map(([path, text]) => [path, strToU8(text)])),
  })
  return new File([zip as Uint8Array<ArrayBuffer>], 'el-faro.epub', { type: 'application/epub+zip' })
}

describe('readEpub', () => {
  it('reads the chapters in spine order, one paragraph per block', async () => {
    const book = await readEpub(epub())
    expect(book).toMatchObject({ title: 'El faro', author: 'Ana Ruiz', language: 'es', chapters: 2 })
    expect(book.text.split('\n\n')).toEqual([
      'Capítulo uno',
      'Marlo subía la escalera cada noche.',
      '灯台',
      'Dos',
      'La luz giraba.',
    ])
  })

  it('keeps heading titles and offsets into the exact extracted text', async () => {
    const book = await readEpub(epub())
    expect(book.toc).toEqual([{ title: 'Capítulo uno', start: 0 }, { title: 'Dos', start: book.text.indexOf('Dos') }])
  })

  it('uses EPUB 3 navigation labels and fragment offsets within a chapter', async () => {
    const book = await readEpub(epub({
      'OEBPS/content.opf': opf.replace('<manifest>', '<manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>'),
      'OEBPS/nav.xhtml': xhtml('<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol><li><a href="text/one.xhtml#intro">Introduction</a></li><li><a href="text/one.xhtml#next">The second part</a></li><li><a href="text/chapter%202.xhtml">Finale</a></li></ol></nav>'),
      'OEBPS/text/one.xhtml': xhtml('<h1 id="intro">First</h1><p>Hello.</p><section id="next"><h2>Next</h2><p>Again.</p></section>'),
    }))
    expect(book.toc).toEqual([
      { title: 'Introduction', start: 0 },
      { title: 'The second part', start: book.text.indexOf('Next') },
      { title: 'Finale', start: book.text.indexOf('Dos') },
    ])
  })

  it('reads EPUB 2 NCX navigation and ignores missing fragment targets', async () => {
    const book = await readEpub(epub({
      'OEBPS/content.opf': opf.replace('<manifest>', '<manifest><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'),
      'OEBPS/toc.ncx': '<ncx><navMap><navPoint><navLabel><text>Start here</text></navLabel><content src="text/one.xhtml"/></navPoint><navPoint><navLabel><text>Missing</text></navLabel><content src="text/chapter%202.xhtml#missing"/></navPoint></navMap></ncx>',
    }))
    expect(book.toc[0]).toEqual({ title: 'Start here', start: 0 })
    expect(book.toc[1]).toEqual({ title: 'Dos', start: book.text.indexOf('Dos') })
  })

  it('refuses books with encrypted chapters', async () => {
    const encryption = '<encryption><EncryptedData><CipherReference URI="OEBPS/text/one.xhtml"/></EncryptedData></encryption>'
    await expect(readEpub(epub({ 'META-INF/encryption.xml': encryption }))).rejects.toMatchObject({ code: 'drm' })
  })

  it('allows obfuscated fonts', async () => {
    const encryption = '<encryption><EncryptedData><CipherReference URI="OEBPS/fonts/serif.otf"/></EncryptedData></encryption>'
    await expect(readEpub(epub({ 'META-INF/encryption.xml': encryption }))).resolves.toMatchObject({ chapters: 2 })
  })

  it('rejects files that are not EPUBs', async () => {
    const error = await readEpub(new File(['hello'], 'notes.epub')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EpubError)
    expect((error as EpubError).code).toBe('invalid')
  })
})
