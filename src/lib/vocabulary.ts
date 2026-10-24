import { db, type WordContext, type WordEntry } from './db'
import { normalizeTerm } from './tokenize'

export function wordFamily(word: WordEntry): string {
  return normalizeTerm((word.family || word.explanation?.lemma || word.term).trim(), word.language)
}

export function relatedWords(word: WordEntry, words: WordEntry[]): WordEntry[] {
  const family = wordFamily(word)
  return words.filter((candidate) => candidate.key !== word.key && candidate.language === word.language && wordFamily(candidate) === family)
    .sort((a, b) => a.term.localeCompare(b.term, word.language))
}

export async function saveWordFamily(key: string, family: string): Promise<void> {
  await db.transaction('rw', db.words, async () => {
    const word = await db.words.get(key)
    if (!word) return
    await db.words.update(key, { family: family.trim().slice(0, 100), statusAt: word.statusAt ?? word.updatedAt, updatedAt: Math.max(Date.now(), word.updatedAt) })
  })
}

/** Merge encounters by source and sentence so reading on two devices never duplicates them. */
export function mergeContexts(a: WordContext[] = [], b: WordContext[] = []): WordContext[] {
  const result = new Map<string, WordContext>()
  for (const context of [...a, ...b]) {
    const key = `${context.source?.id ?? ''}\u0000${context.sentence}`
    const old = result.get(key)
    if (!old) { result.set(key, context); continue }
    const difference = (context.updatedAt ?? context.seenAt) - (old.updatedAt ?? old.seenAt)
    const [earlier, later] = difference > 0 || (difference === 0 && JSON.stringify(context) > JSON.stringify(old)) ? [old, context] : [context, old]
    result.set(key, { ...earlier, ...later, explanation: later.explanation ?? earlier.explanation, translation: later.translation ?? earlier.translation, seenAt: Math.min(old.seenAt, context.seenAt) })
  }
  return [...result.values()].sort((a, b) => b.seenAt - a.seenAt || a.id.localeCompare(b.id))
}
