import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { WordPanel } from '../components/WordPanel'
import { ui } from '../components/ui'
import { addText, db, setWordStatus, wordKey, type WordStatus } from '../lib/db'
import { useT, useUiLanguage } from '../lib/i18n'
import { LANGUAGES, languageName } from '../lib/languages'
import { updateSettings, useSettings } from '../lib/settings'
import { activeCueAt, checkDictation, MAX_MEDIA_BYTES, MAX_SUBTITLE_BYTES, parseSubtitles, SubtitleError, subtitleTime, type SubtitleCue } from '../lib/subtitles'
import { tokenize } from '../lib/tokenize'

const PAGE_SIZE = 60
type Selection = { term: string; surface: string; sentence: string }
type MediaSource = { url: string; name: string; video: boolean }

/** Files intentionally stay session-local: media is streamed from an object URL, never copied into IndexedDB. */
export function ListeningPage() {
  const t = useT()
  const uiLanguage = useUiLanguage()
  const settings = useSettings()
  const [language, setLanguage] = useState(settings.lastTextLanguage)
  const [title, setTitle] = useState('')
  const [cues, setCues] = useState<SubtitleCue[]>([])
  const [media, setMedia] = useState<MediaSource>()
  const [error, setError] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [selectedCue, setSelectedCue] = useState(0)
  const [page, setPage] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)
  const [dictation, setDictation] = useState(false)
  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)
  const [selection, setSelection] = useState<Selection>()
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<number>()
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const mounted = useRef(true)
  const importVersion = useRef(0)
  const selectionVersion = useRef(0)
  const active = activeCueAt(cues, currentTime)
  const cue = cues[selectedCue]
  const words = useLiveQuery(() => db.words.where('language').equals(language).toArray(), [language])
  const wordMap = useMemo(() => new Map(words?.map((word) => [word.term, word])), [words])
  const visibleCues = useMemo(() => cues.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => ({
    ...item, sentences: tokenize(item.text, language).flatMap((paragraph) => paragraph.sentences),
  })), [cues, language, page])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // These refs are request counters, not DOM nodes; invalidate outstanding operations on cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      importVersion.current++
      // eslint-disable-next-line react-hooks/exhaustive-deps
      selectionVersion.current++
    }
  }, [])

  useEffect(() => {
    const element = mediaRef.current
    return () => {
      element?.pause()
      element?.removeAttribute('src')
      element?.load()
      if (media) URL.revokeObjectURL(media.url)
    }
  }, [media])

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = speed
  }, [speed, media])

  // Enforce sentence boundaries between timeupdate events, which fire too slowly for short cues.
  useEffect(() => {
    const element = mediaRef.current
    if (!element || !cue || (!loop && !dictation)) return
    let frame = 0
    const tick = () => {
      if (!element.paused && element.currentTime >= cue.end) {
        if (loop) element.currentTime = cue.start
        else { element.pause(); element.currentTime = cue.end }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [media, cue, loop, dictation])

  useEffect(() => {
    if (active >= 0 && !mediaRef.current?.paused && !dictation) setPage(Math.floor(active / PAGE_SIZE))
  }, [active, dictation])

  async function importSubtitles(file?: File) {
    if (!file) return
    const version = ++importVersion.current
    setError('')
    try {
      if (file.size > MAX_SUBTITLE_BYTES) throw new SubtitleError('size')
      const imported = parseSubtitles(await file.text())
      if (!mounted.current || version !== importVersion.current) return
      mediaRef.current?.pause()
      setCues(imported)
      setTitle(file.name.replace(/\.(srt|vtt)$/i, ''))
      setSelectedCue(0)
      setPage(0)
      setSelection(undefined)
      selectionVersion.current++
      setAnswer('')
      setChecked(false)
      setSavedId(undefined)
      setLoop(false)
      setCurrentTime(0)
      if (mediaRef.current) mediaRef.current.currentTime = 0
    } catch (cause) {
      if (!mounted.current || version !== importVersion.current) return
      setError(cause instanceof SubtitleError ? t(cause.code === 'size' ? 'listen.subtitleSize' : cause.code === 'empty' ? 'listen.subtitleEmpty' : 'listen.subtitleFormat') : t('listen.fileError'))
    }
  }

  function selectMedia(file?: File) {
    if (!file) return
    setError('')
    if (file.size > MAX_MEDIA_BYTES) { setError(t('listen.mediaSize')); return }
    if (!/^(audio|video)\//.test(file.type) && !/\.(mp3|mp4|m4a|m4v|wav|ogg|oga|ogv|webm|flac|aac|mov)$/i.test(file.name)) {
      setError(t('listen.mediaError')); return
    }
    mediaRef.current?.pause()
    const video = file.type.startsWith('video/') || /\.(mp4|m4v|ogv|webm|mov)$/i.test(file.name)
    setMedia({ url: URL.createObjectURL(file), name: file.name, video })
    setCurrentTime(0)
  }

  function selectCue(index: number, play = true) {
    const item = cues[index]
    if (!item) return
    setSelectedCue(index)
    setPage(Math.floor(index / PAGE_SIZE))
    if (index !== selectedCue) { setAnswer(''); setChecked(false) }
    setCurrentTime(item.start)
    const element = mediaRef.current
    if (!element) return
    if (Number.isFinite(element.duration) && item.start >= element.duration) { setError(t('listen.cueBeyondMedia')); return }
    element.currentTime = item.start
    setError('')
    if (play) void element.play().catch(() => { if (mounted.current) setError(t('listen.mediaError')) })
  }

  async function selectWord(next: Selection) {
    const version = ++selectionVersion.current
    mediaRef.current?.pause()
    setError('')
    try {
      const existing = await db.words.get(wordKey(language, next.term))
      if (!existing) await setWordStatus(language, next.term, 'learning', next.sentence)
      if (mounted.current && version === selectionVersion.current) setSelection(next)
    } catch { if (mounted.current) setError(t('listen.wordError')) }
  }

  async function changeStatus(status: WordStatus) {
    if (!selection) return
    try { await setWordStatus(language, selection.term, status, selection.sentence) }
    catch { setError(t('listen.wordError')) }
  }

  async function saveTranscript() {
    if (saving || savedId || !cues.length) return
    setSaving(true)
    setError('')
    const version = importVersion.current
    try {
      const id = await addText({ title: title.trim() || t('listen.transcript'), language, content: cues.map((item) => item.text).join('\n\n') })
      if (mounted.current && version === importVersion.current) setSavedId(id)
    } catch { if (mounted.current) setError(t('listen.saveError')) }
    finally { if (mounted.current) setSaving(false) }
  }

  const result = checked && cue ? checkDictation(cue.text, answer, language) : undefined
  const mediaProps = {
    ref: (element: HTMLMediaElement | null) => { mediaRef.current = element },
    src: media?.url, controls: true, preload: 'metadata',
    onTimeUpdate: () => setCurrentTime(mediaRef.current?.currentTime ?? 0),
    onError: () => setError(t('listen.mediaError')),
    onEnded: () => {
      const element = mediaRef.current
      if (loop && cue && element && cue.start < element.duration) {
        element.currentTime = cue.start
        void element.play().catch(() => setError(t('listen.mediaError')))
      }
    },
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <header><h1 className={ui.pageTitle}>{t('listen.title')}</h1><p className={`${ui.muted} mt-2 max-w-3xl`}>{t('listen.intro')}</p></header>
      <section className={`${ui.card} grid gap-4 p-4 sm:grid-cols-2`}>
        <div><label htmlFor="subtitle-file" className={ui.label}>{t('listen.subtitleFile')}</label><input id="subtitle-file" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className={ui.input} onChange={(event) => { void importSubtitles(event.target.files?.[0]); event.target.value = '' }} /></div>
        <div><label htmlFor="listening-media" className={ui.label}>{t('listen.mediaFile')}</label><input id="listening-media" type="file" accept="audio/*,video/*" className={ui.input} onChange={(event) => { selectMedia(event.target.files?.[0]); event.target.value = '' }} /></div>
        <div><label htmlFor="listening-language" className={ui.label}>{t('listen.language')}</label><select id="listening-language" value={language} disabled={saving} className={ui.input} onChange={(event) => { setLanguage(event.target.value); updateSettings({ lastTextLanguage: event.target.value }); selectionVersion.current++; setSelection(undefined); setChecked(false); setSavedId(undefined) }}>{LANGUAGES.map((code) => <option key={code} value={code}>{languageName(code, uiLanguage)}</option>)}</select></div>
        <div><label htmlFor="listening-title" className={ui.label}>{t('listen.titleLabel')}</label><input id="listening-title" value={title} maxLength={300} disabled={saving} className={ui.input} onChange={(event) => { setTitle(event.target.value); setSavedId(undefined) }} /></div>
        <p className={`${ui.muted} sm:col-span-2`}>{t('listen.localNotice')}</p>
      </section>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200" role="alert">{error}</p> : null}
      {media ? <section className={`${ui.card} flex flex-col gap-3 p-4`}>
        <p className={`${ui.muted} truncate`}>{media.name}</p>
        {media.video ? <video key={media.url} {...mediaProps} className="max-h-96 w-full rounded-lg bg-black" /> : <audio key={media.url} {...mediaProps} className="w-full" />}
        <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm">{t('listen.speed')}<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className={`${ui.input} w-auto`}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={loop} disabled={!cue} onChange={(event) => { setLoop(event.target.checked); if (event.target.checked) selectCue(selectedCue, false) }} />{t('listen.loop')}</label></div>
      </section> : <p className={ui.muted}>{t('listen.noMedia')}</p>}
      {!cues.length ? <div className={`${ui.card} p-10 text-center text-stone-500`}>{t('listen.noSubtitles')}</div> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={ui.muted}>{t('listen.cueCount', { count: cues.length, duration: subtitleTime(Math.max(...cues.map((item) => item.end))) })}</p>
          {savedId ? <a href={`#/read/${savedId}`} className={ui.secondaryButton}>{t('listen.openSaved')}</a> : <button type="button" onClick={() => void saveTranscript()} disabled={saving} className={ui.secondaryButton}>{t('listen.save')}</button>}
          {savedId ? <span role="status" className={ui.muted}>{t('listen.saved')}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('listen.title')}>
          {[false, true].map((value) => <button key={String(value)} type="button" className={dictation === value ? ui.primaryButton : ui.secondaryButton} aria-pressed={dictation === value} onClick={() => { mediaRef.current?.pause(); setDictation(value); setChecked(false); setAnswer(''); setSelection(undefined); selectionVersion.current++; if (value) selectCue(active >= 0 ? active : selectedCue, false) }}>{t(value ? 'listen.dictationMode' : 'listen.listenMode')}</button>)}
        </div>
        <div className={`grid items-start gap-5 ${selection ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
          <section className={`${ui.card} overflow-hidden`}>
            {dictation && cue ? <div className="flex flex-col gap-4 p-5">
              <p className={ui.muted}>{t('listen.dictationHelp')}</p>
              <div className="flex flex-wrap items-center gap-2"><button type="button" className={ui.secondaryButton} disabled={!media} onClick={() => selectCue(selectedCue)}>{t('listen.replay')}</button><span className={ui.muted}>{t('listen.cuePosition', { n: selectedCue + 1, count: cues.length })}</span></div>
              <label htmlFor="dictation-answer" className={ui.label}>{t('listen.answer')}</label>
              <textarea id="dictation-answer" lang={language} dir="auto" rows={4} maxLength={8000} value={answer} spellCheck={false} autoComplete="off" className={ui.input} onChange={(event) => { setAnswer(event.target.value); setChecked(false) }} />
              <button type="button" disabled={!answer.trim()} className={`${ui.primaryButton} self-start`} onClick={() => { mediaRef.current?.pause(); setChecked(true) }}>{t('listen.check')}</button>
              {result ? <div role="status" className="rounded-lg bg-indigo-50 p-4 dark:bg-indigo-500/10"><p className="font-medium">{result.correct ? t('listen.correct') : t('listen.accuracy', { accuracy: result.accuracy, mistakes: result.mistakes })}</p><p className={`${ui.muted} mt-2`}>{t('listen.expected')}</p><p lang={language} dir="auto" className="font-reading mt-1 text-lg">{cue.text}</p><button type="button" className={`${ui.ghostButton} mt-2`} onClick={() => { setChecked(false); setAnswer('') }}>{t('listen.again')}</button></div> : null}
              <div className="flex justify-between gap-2"><button type="button" disabled={!selectedCue} className={ui.secondaryButton} onClick={() => selectCue(selectedCue - 1, false)}>{t('listen.previous')}</button><button type="button" disabled={selectedCue === cues.length - 1} className={ui.secondaryButton} onClick={() => selectCue(selectedCue + 1, false)}>{t('listen.next')}</button></div>
            </div> : <>
              <h2 className="border-b border-stone-200 p-4 font-semibold dark:border-stone-800">{t('listen.transcript')}</h2>
              <ol className="max-h-[36rem] overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800" start={page * PAGE_SIZE + 1}>
                {visibleCues.map((item, offset) => {
                  const index = page * PAGE_SIZE + offset
                  return <li key={index} aria-current={active === index ? 'true' : undefined} className={`flex gap-3 p-4 ${active === index ? 'bg-indigo-50 dark:bg-indigo-500/15' : ''} ${selectedCue === index ? 'border-l-2 border-l-indigo-500' : 'border-l-2 border-l-transparent'}`}>
                    <button type="button" className={`${ui.ghostButton} h-fit shrink-0 tabular-nums`} aria-label={t('listen.playCue', { n: index + 1 })} onClick={() => selectCue(index)}>{subtitleTime(item.start)}</button>
                    <p lang={language} dir="auto" className="font-reading text-lg leading-relaxed">{item.sentences.map((sentence, sentenceIndex) => <span key={sentenceIndex}>{sentence.tokens.map((token, tokenIndex) => token.kind === 'text' ? token.text : <button key={tokenIndex} type="button" onClick={() => void selectWord({ term: token.term, surface: token.text, sentence: sentence.text })} className={`rounded px-0.5 text-start hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-indigo-500/25 ${wordMap.get(token.term)?.status === 'learning' ? 'bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100' : ''}`}>{token.text}</button>)}{' '}</span>)}</p>
                  </li>
                })}
              </ol>
              {cues.length > PAGE_SIZE ? <div className="flex justify-between gap-2 border-t border-stone-200 p-3 dark:border-stone-800"><button type="button" className={ui.ghostButton} disabled={page === 0} onClick={() => { mediaRef.current?.pause(); setPage(page - 1) }}>{t('listen.previousPage')}</button><button type="button" className={ui.ghostButton} disabled={(page + 1) * PAGE_SIZE >= cues.length} onClick={() => { mediaRef.current?.pause(); setPage(page + 1) }}>{t('listen.nextPage')}</button></div> : null}
            </>}
          </section>
          {selection ? <aside className={`${ui.card} p-4 lg:sticky lg:top-4`}><WordPanel key={wordKey(language, selection.term) + selection.sentence} language={language} {...selection} source={{ id: savedId ? `text:${savedId}` : `listening:${title}`, title: title || t('listen.transcript') }} entry={wordMap.get(selection.term)} autoExplain={wordMap.get(selection.term)?.status === 'learning'} onStatus={(status) => void changeStatus(status)} onClose={() => { selectionVersion.current++; setSelection(undefined) }} /></aside> : null}
        </div>
      </>}
    </div>
  )
}
