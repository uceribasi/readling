import { englishLanguageName } from '../languages'

export interface Explanation {
  lemma: string
  partOfSpeech: string
  translation: string
  meaning: string
  grammar: string
  example: string
  exampleTranslation: string
}

const FIELDS = [
  'lemma',
  'partOfSpeech',
  'translation',
  'meaning',
  'grammar',
  'example',
  'exampleTranslation',
] as const satisfies readonly (keyof Explanation)[]

export const EXPLANATION_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(FIELDS.map((field) => [field, { type: 'string' }])),
  required: [...FIELDS],
  additionalProperties: false,
}

/** One request to a model: instructions, the user's message and, optionally, a JSON schema for the reply. */
export interface Completion {
  system: string
  user: string
  schema?: Record<string, unknown>
  /** How hard the model should think; short glosses use "low". */
  effort?: 'low' | 'medium'
}

export interface ExplainRequest {
  /** Normalized (lowercased) form, used for caching. */
  term: string
  /** The word exactly as it appears in the text. */
  surface: string
  sentence: string
  language: string
  explanationLanguage: string
}

export type AiErrorCode =
  | 'no-key'
  | 'no-model'
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'model'
  | 'refusal'
  | 'bad-response'
  | 'workspace'
  | 'bridge-offline'
  | 'bridge-auth'
  | 'agent-missing'
  | 'agent-failed'
  | 'timeout'
  | 'builtin-unavailable'
  | 'builtin-language'
  | 'builtin-activation'
  | 'builtin-download'
  | 'other'

export class AiError extends Error {
  code: AiErrorCode

  constructor(code: AiErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'AiError'
    this.code = code
  }
}

export function buildPrompt(request: ExplainRequest): { system: string; user: string } {
  const target = englishLanguageName(request.language)
  const native = englishLanguageName(request.explanationLanguage)
  const system = [
    `You are a friendly, concise language tutor inside a reading app.`,
    `The learner is reading a text in ${target}. Their native language is ${native}.`,
    `Explain the selected word or phrase exactly as it is used in the given sentence.`,
    `Return a JSON object with these keys:`,
    `- lemma: the dictionary form of the word (or the base form of the phrase) in ${target}.`,
    `- partOfSpeech: a short label in ${native}.`,
    `- translation: the best 1-4 word translation into ${native} for this context.`,
    `- meaning: 1-2 sentences in ${native} explaining what the word means here.`,
    `- grammar: one short sentence in ${native} about the form used here (tense, case, plural, idiom...), or an empty string if nothing is notable.`,
    `- example: a new, simple sentence in ${target} that uses it with the same meaning.`,
    `- exampleTranslation: the translation of that example into ${native}.`,
    `Reply with the JSON object only.`,
  ].join('\n')
  const user = `Sentence: ${request.sentence}\nSelected ${request.term.includes(' ') ? 'phrase' : 'word'}: ${request.surface}`
  return { system, user }
}

export interface SentenceRequest {
  sentence: string
  language: string
  /** Language to translate into (the learner's explanation language). */
  target: string
}

export function sentencePrompt(request: SentenceRequest): Completion {
  const source = englishLanguageName(request.language)
  const target = englishLanguageName(request.target)
  return {
    system: [
      `You translate sentences for a language learner reading a ${source} text.`,
      `Translate the sentence into natural ${target}, keeping its meaning and tone.`,
      'Reply with the translation only: no quotes, notes or explanations.',
    ].join('\n'),
    user: request.sentence,
    effort: 'low',
  }
}

/** Removes the wrapping some models add around a plain answer (code fences, quotes, reasoning). */
export function cleanPlainReply(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^```\w*\n?|\n?```$/g, '')
    .trim()
    .replace(/^["“«„'](.*)["”»“']$/s, '$1')
    .trim()
}

/** Pulls the JSON object out of a model reply, tolerating code fences, chatter and reasoning tags. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new AiError('bad-response')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new AiError('bad-response')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AiError('bad-response')
  return parsed as Record<string, unknown>
}

/** Parses a model reply into an Explanation. */
export function parseExplanation(text: string): Explanation {
  const record = parseJsonObject(text)
  const explanation = Object.fromEntries(
    FIELDS.map((field) => [field, typeof record[field] === 'string' ? (record[field] as string).trim() : '']),
  ) as unknown as Explanation
  if (!explanation.translation && !explanation.meaning) throw new AiError('bad-response')
  return explanation
}
