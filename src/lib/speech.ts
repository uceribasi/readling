/** Pronunciation with the browser's built-in speech synthesis: local voices work offline; other voices may use a remote speech service. */
import { getSettings } from './settings'

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

/** The voice part of a name, without accents or case, e.g. "İyi Haber" → "iyi haber". */
function plainName(voice: Pick<SpeechSynthesisVoice, 'name'>): string {
  return voice.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/**
 * macOS sound-effect voices (whispering, singing, bubbling…), which browsers list among the
 * ordinary English voices. Some names are translated with the system language.
 */
const NOVELTY_VOICES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news', 'hysterical', 'jester',
  'organ', 'pipe organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'fred', 'junior', 'kathy', 'ralph',
  'agnes', 'bruce', 'princess', 'vicki', 'victoria',
  'iyi haber', 'kotu haber', 'org', 'gute nachrichten', 'schlechte nachrichten', 'orgel', 'buenas noticias',
  'malas noticias', 'organo', 'boas noticias', 'mas noticias', 'orgao',
])

/** Older synthetic voices that sound robotic next to the natural ones. */
const ROBOTIC_VOICE = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/

/** Natural-sounding voices that ship with macOS and iOS. */
const NATURAL_VOICES = new Set([
  'samantha', 'daniel', 'karen', 'moira', 'tessa', 'rishi', 'alex', 'ava', 'allison', 'evan', 'nathan', 'zoe', 'tom', 'serena', 'kate', 'oliver',
  'monica', 'paulina', 'jorge', 'juan', 'diego', 'marisol', 'anna', 'helena', 'markus', 'petra', 'yannick', 'thomas', 'amelie', 'audrey',
  'aurelie', 'alice', 'federica', 'luca', 'luciana', 'joana', 'felipe', 'yelda', 'cem', 'kyoko', 'otoya', 'hattori', 'ting-ting',
  'tingting', 'meijia', 'sinji', 'li-mu', 'yu-shu', 'yuna', 'milena', 'yuri', 'ellen', 'xander', 'claire', 'alva', 'klara', 'oskar',
  'zosia', 'ewa', 'majed', 'maged', 'tarik', 'carmit', 'lesya', 'montse', 'nora', 'sara', 'laura', 'zuzana', 'tunde', 'ioana',
])

/** Higher is better; below zero means "only if there's nothing else". */
export function voiceScore(voice: Pick<SpeechSynthesisVoice, 'name' | 'localService' | 'default'>): number {
  const name = plainName(voice)
  if (NOVELTY_VOICES.has(name)) return -10
  let score = 0
  if (ROBOTIC_VOICE.test(name)) score -= 2
  if (NATURAL_VOICES.has(name.split(/[\s(]/)[0])) score += 4
  if (/premium|enhanced|neural|natural|siri/.test(name)) score += 6
  if (/^(google|microsoft)\b/.test(name)) score += 3
  if (voice.default) score += 2
  // Local voices work offline and report each word as it's read.
  if (voice.localService) score += 1
  return score
}

/** A language's voices, best first. */
export function voicesFor(language: string): SpeechSynthesisVoice[] {
  if (!canSpeak()) return []
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === language.toLowerCase())
    .sort((a, b) => voiceScore(b) - voiceScore(a))
}

/** The voice picked in Settings for this language, or the best one installed. */
function voiceFor(language: string): SpeechSynthesisVoice | undefined {
  const voices = voicesFor(language)
  const chosen = getSettings().voices[language]
  return voices.find((voice) => voice.name === chosen) ?? voices[0]
}

/** Browsers load the voice list after the page; wait for it (briefly) so the right voice is used. */
export function voicesReady(): Promise<void> {
  if (!canSpeak() || window.speechSynthesis.getVoices().length) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve()
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    setTimeout(done, 1500)
  })
}

// Bumped whenever something new starts speaking, so an older read-aloud knows it was interrupted.
let session = 0

export function speak(text: string, language: string, rate = 0.9): void {
  if (!canSpeak() || !text.trim()) return
  const id = ++session
  const synth = window.speechSynthesis
  synth.cancel()
  void voicesReady().then(() => {
    if (id !== session) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language
    utterance.rate = rate
    const voice = voiceFor(language)
    if (voice) utterance.voice = voice
    synth.speak(utterance)
  })
}

export interface ReadAloudHandlers {
  /** A sentence started. */
  onSentence: (index: number) => void
  /** A word started, at `charIndex` in the sentence (not every voice reports words). */
  onWord: (index: number, charIndex: number) => void
  /** Reading ended: `finished` is false when it was interrupted. Not called after stop(). */
  onDone: (finished: boolean) => void
}

/**
 * Reads sentences aloud one at a time, starting at `from`. One utterance per sentence keeps
 * progress reporting simple and avoids browsers cutting off long utterances. Returns stop().
 */
export function readAloud(sentences: string[], language: string, from: number, rate: number, handlers: ReadAloudHandlers): () => void {
  if (!canSpeak()) {
    handlers.onDone(false)
    return () => {}
  }
  const synth = window.speechSynthesis
  synth.cancel()
  const id = ++session
  let voice: SpeechSynthesisVoice | undefined
  // Some browsers drop events of utterances nothing refers to anymore.
  const utterances: SpeechSynthesisUtterance[] = []
  let active = true
  const finish = (finished: boolean) => {
    if (!active) return
    active = false
    handlers.onDone(finished)
  }

  const next = (index: number) => {
    if (!active) return
    if (id !== session) return finish(false)
    if (index >= sentences.length) return finish(true)
    const utterance = new SpeechSynthesisUtterance(sentences[index])
    utterance.lang = language
    utterance.rate = rate
    if (voice) utterance.voice = voice
    utterance.onstart = () => active && handlers.onSentence(index)
    utterance.onboundary = (event) => {
      if (active && event.name === 'word') handlers.onWord(index, event.charIndex)
    }
    utterance.onend = () => next(index + 1)
    utterance.onerror = () => finish(false)
    utterances.push(utterance)
    synth.speak(utterance)
  }
  void voicesReady().then(() => {
    voice = voiceFor(language)
    next(from)
  })

  return () => {
    if (!active) return
    active = false
    if (id === session) {
      session++
      synth.cancel()
    }
  }
}
