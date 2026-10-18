/** AI-written reading material: graded stories and easier rewrites of existing texts. */
import { englishLanguageName } from '../languages'
import type { Level } from '../levels'
import type { Settings } from '../settings'
import { generateJson } from './index'
import { AiError, type Completion } from './types'

export const STORY_LENGTHS = { short: 150, medium: 300, long: 600 } as const
export type StoryLength = keyof typeof STORY_LENGTHS

const LEVEL_GUIDE: Record<Level, string> = {
  A1: 'very short, simple sentences in the present tense, using only the most common words',
  A2: 'short sentences about everyday things, common vocabulary, simple past and future',
  B1: 'clear, connected sentences, everyday vocabulary with some abstract words, the common tenses',
  B2: 'varied sentences, a wider vocabulary and a few common idioms',
  C1: 'rich, natural prose with idioms and complex sentences',
  C2: 'sophisticated prose, as a skilled native writer would write it',
}

const TEXT_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, text: { type: 'string' } },
  required: ['title', 'text'],
  additionalProperties: false,
}

const JSON_REPLY = [
  'Return a JSON object with two keys:',
  '- title: a short title in the same language as the text.',
  '- text: the full text, with paragraphs separated by a blank line ("\\n\\n").',
  'Reply with the JSON object only.',
]

export interface StoryRequest {
  language: string
  level: Level
  topic: string
  length: StoryLength
  /** Words the learner is studying, to be worked into the story. */
  words: string[]
}

export function storyPrompt(request: StoryRequest): Completion {
  const target = englishLanguageName(request.language)
  const system = [
    'You write graded reading texts for language learners.',
    `Write only in ${target}, at CEFR level ${request.level}: ${LEVEL_GUIDE[request.level]}.`,
    `Write an engaging, self-contained story of about ${STORY_LENGTHS[request.length]} words, in short paragraphs.`,
    ...(request.words.length
      ? [`Work these words the learner is studying into the story naturally, each at least once, in whatever form fits: ${request.words.join(', ')}.`]
      : []),
    ...JSON_REPLY,
  ].join('\n')
  const user = `Topic: ${request.topic.trim() || 'anything a learner would enjoy reading'}`
  return { system, user, schema: TEXT_SCHEMA, effort: 'medium' }
}

export interface SimplifyRequest {
  language: string
  level: Level
  title: string
  text: string
}

export function simplifyPrompt(request: SimplifyRequest): Completion {
  const target = englishLanguageName(request.language)
  const system = [
    'You rewrite texts for language learners.',
    `Rewrite the text in ${target} at CEFR level ${request.level}: ${LEVEL_GUIDE[request.level]}.`,
    `Keep the meaning, facts, names and order of events. Keep it in ${target}; don't translate it.`,
    ...JSON_REPLY,
  ].join('\n')
  return { system, user: `Title: ${request.title}\n\n${request.text}`, schema: TEXT_SCHEMA, effort: 'medium' }
}

/** Checks a reply and makes sure paragraphs are separated by blank lines, as readling expects. */
export function parseWrittenText(record: Record<string, unknown>): { title: string; text: string } {
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  let text = typeof record.text === 'string' ? record.text.trim() : ''
  if (!text) throw new AiError('bad-response')
  if (!/\n\s*\n/.test(text)) text = text.replace(/\n+/g, '\n\n')
  return { title, text }
}

export async function writeStory(settings: Settings, request: StoryRequest, signal?: AbortSignal) {
  const languages = { input: [request.language], output: request.language }
  return parseWrittenText(await generateJson(settings, storyPrompt(request), signal, languages))
}

export async function simplifyText(settings: Settings, request: SimplifyRequest, signal?: AbortSignal) {
  const languages = { input: [request.language], output: request.language }
  return parseWrittenText(await generateJson(settings, simplifyPrompt(request), signal, languages))
}
