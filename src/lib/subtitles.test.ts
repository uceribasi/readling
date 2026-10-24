import { describe, expect, it } from 'vitest'
import { activeCueAt, checkDictation, MAX_SUBTITLE_BYTES, parseSubtitles, subtitleTime } from './subtitles'

describe('subtitle imports', () => {
  it('reads BOM, CRLF, multiline SRT and strips cue markup without executing it', () => {
    expect(parseSubtitles('\uFEFF1\r\n00:00:01,250 --> 00:00:03,400\r\n<i>Hello</i> &amp;\r\ngoodbye.\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nAgain.')).toEqual([
      { start: 1.25, end: 3.4, text: 'Hello &\ngoodbye.' }, { start: 5, end: 6, text: 'Again.' },
    ])
  })
  it('reads WebVTT identifiers, cue settings, comments and two-part timestamps', () => {
    const cues = parseSubtitles('WEBVTT\nKind: captions\n\nNOTE a comment\nmore\n\nSTYLE\n::cue { color: red; }\n\nfirst\n00:01.000 --> 00:03.000 align:start position:10%\n<v Sam>Hello &#x1f600;</v>\n\n00:00:02.000 --> 00:00:04.000\nOverlapping.')
    expect(cues).toEqual([{ start: 1, end: 3, text: 'Hello 😀' }, { start: 2, end: 4, text: 'Overlapping.' }])
  })
  it.each([
    '', 'garbage', 'WEBVTT', '1\n00:60:00,000 --> 00:60:01,000\nNo.',
    '1\n00:00:01,000 --> 00:00:00,000\nNo.', '1\n00:00:00,000 --> 00:00:00,000\nNo.',
    '1\n00:00:00.000 --> 00:00:01.000\nNo.', '1\n00:00:00,000 --> 00:00:01,000\n',
    '1\n00:00:03,000 --> 00:00:04,000\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nLate',
    '1\n00:00:00,000 --> 00:00:01,000\nFirst\n2\n00:00:01,000 --> 00:00:02,000\nBroken separator',
  ])('rejects malformed files: %s', (source) => expect(() => parseSubtitles(source)).toThrow())
  it('bounds file size and cue content', () => {
    expect(() => parseSubtitles('x'.repeat(MAX_SUBTITLE_BYTES + 1))).toThrow('size')
    expect(() => parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n' + 'x'.repeat(4_001))).toThrow('size')
  })
})

it('finds overlapping cues and gaps without extending exclusive ends', () => {
  const cues = [{ start: 1, end: 5, text: 'long' }, { start: 2, end: 3, text: 'short' }, { start: 6, end: 7, text: 'last' }]
  expect([0, 1, 2, 3, 5, 6, 7, NaN].map((time) => activeCueAt(cues, time))).toEqual([-1, 0, 1, 0, -1, 2, -1, -1])
  expect(subtitleTime(3661.9)).toBe('1:01:01')
})

describe('dictation feedback', () => {
  it('ignores case, punctuation, whitespace and curly apostrophes', () => {
    expect(checkDictation("Don't go home!", 'DON’T  go home.', 'en')).toEqual({ correct: true, accuracy: 100, mistakes: 0 })
    expect(checkDictation('İstanbul çok güzel.', 'istanbul çok güzel', 'tr').correct).toBe(true)
  })
  it('penalizes missing, extra and wrong words', () => {
    expect(checkDictation('We went home today.', 'We home today', 'en')).toEqual({ correct: false, accuracy: 75, mistakes: 1 })
    expect(checkDictation('We went home.', 'We went to home', 'en')).toEqual({ correct: false, accuracy: 75, mistakes: 1 })
    expect(checkDictation('We went home.', 'We go home', 'en').mistakes).toBe(1)
  })
  it('keeps accents meaningful, handles unspaced languages, and rejects empty answers', () => {
    expect(checkDictation('Él llegó.', 'El llego', 'es').correct).toBe(false)
    expect(checkDictation('私は学生です。', '私は学生です', 'ja').correct).toBe(true)
    expect(checkDictation('Hello.', '!!!', 'en')).toMatchObject({ correct: false, accuracy: 0 })
  })
})
