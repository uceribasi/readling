/**
 * Wikipedia articles as reading material, in every language readling supports.
 * Requests go straight from the browser to Wikipedia's public API (it allows CORS with origin=*).
 */

export interface WikiResult {
  title: string
  snippet: string
  wordCount: number
}

export interface WikiArticle {
  title: string
  text: string
  url: string
}

export class WikipediaError extends Error {
  code: 'network' | 'not-found'

  constructor(code: 'network' | 'not-found') {
    super(`wikipedia-${code}`)
    this.name = 'WikipediaError'
    this.code = code
  }
}

/** Reference sections at the end of articles, which aren't worth reading as prose. */
const END_SECTIONS = new Set(
  [
    'see also', 'references', 'notes', 'further reading', 'external links', 'bibliography', 'sources', 'citations', 'footnotes',
    'siehe auch', 'literatur', 'weblinks', 'einzelnachweise', 'anmerkungen', 'quellen',
    'véase también', 'referencias', 'notas', 'bibliografía', 'enlaces externos', 'fuentes',
    'voir aussi', 'notes et références', 'références', 'bibliographie', 'liens externes', 'articles connexes', 'annexes',
    'voci correlate', 'note', 'bibliografia', 'collegamenti esterni', 'altri progetti',
    'ver também', 'referências', 'ligações externas',
    'zie ook', 'externe links', 'referenties', 'bronnen', 'noten', 'bronvermelding',
    'se även', 'referenser', 'noter', 'externa länkar', 'källor', 'litteratur', 'vidare läsning',
    'zobacz też', 'przypisy', 'linki zewnętrzne',
    'см. также', 'примечания', 'литература', 'ссылки', 'источники',
    'див. також', 'примітки', 'посилання', 'джерела',
    'ayrıca bakınız', 'kaynakça', 'notlar', 'dış bağlantılar', 'kaynaklar',
    '脚注', '参考文献', '関連項目', '外部リンク', '出典', '注釈',
    '参见', '參見', '參考文獻', '外部链接', '外部連結', '注释', '註釋', '参考资料', '參考資料',
    '같이 보기', '각주', '참고 문헌', '외부 링크', '참고 자료',
    'انظر أيضا', 'انظر أيضًا', 'المراجع', 'مراجع', 'وصلات خارجية', 'روابط خارجية', 'هوامش', 'مصادر', 'ملاحظات',
    'جستارهای وابسته', 'منابع', 'پیوند به بیرون', 'یادداشت‌ها', 'پانویس', 'منابع و پانویس',
    'ראו גם', 'הערות שוליים', 'קישורים חיצוניים', 'לקריאה נוספת', 'מקורות', 'הערות',
  ].map((name) => name.toLocaleLowerCase()),
)

const HEADING = /^(=+)\s*(.+?)\s*\1$/

/**
 * Cleans a plain-text extract: drops the reference sections at the end and empty
 * sections, and puts every paragraph and heading on its own (blank-line separated) block.
 */
export function cleanExtract(extract: string): string {
  const blocks: string[] = []
  let heading: string | null = null
  for (const raw of extract.replace(/[​‎‏]/g, '').split('\n')) {
    const line = raw.replace(/\(\s*[,;]?\s*\)/g, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    const match = HEADING.exec(line)
    if (match) {
      if (END_SECTIONS.has(match[2].toLocaleLowerCase())) break
      heading = match[2]
      continue
    }
    // A heading only shows up once its section has some text.
    if (heading) blocks.push(heading)
    heading = null
    blocks.push(line)
  }
  return blocks.join('\n\n')
}

async function api<T>(language: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' })
  try {
    const response = await fetch(`https://${language}.wikipedia.org/w/api.php?${query}`, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as T
  } catch (error) {
    if (signal?.aborted) throw error
    throw new WikipediaError('network')
  }
}

function stripTags(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
}

export async function searchWikipedia(query: string, language: string, signal?: AbortSignal): Promise<WikiResult[]> {
  const data = await api<{ query?: { search?: { title: string; snippet: string; wordcount: number }[] } }>(
    language,
    { action: 'query', list: 'search', srsearch: query, srlimit: '8', srprop: 'snippet|wordcount', srnamespace: '0' },
    signal,
  )
  return (data.query?.search ?? []).map((result) => ({
    title: result.title,
    snippet: stripTags(result.snippet),
    wordCount: result.wordcount,
  }))
}

export async function fetchArticle(title: string, language: string, signal?: AbortSignal): Promise<WikiArticle> {
  const data = await api<{ query?: { pages?: { title: string; extract?: string; missing?: boolean }[] } }>(
    language,
    { action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', redirects: '1', titles: title },
    signal,
  )
  const page = data.query?.pages?.[0]
  const text = page?.extract ? cleanExtract(page.extract) : ''
  if (!page || page.missing || !text) throw new WikipediaError('not-found')
  return {
    title: page.title,
    text,
    url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
  }
}
