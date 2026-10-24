import { useEffect } from 'react'
import { explainWord } from '../lib/ai'
import { db, saveExplanation, setWordStatus, wordKey } from '../lib/db'
import { createExtensionLookupHandler, type ExtensionLookupResponse } from '../lib/extensionLookup'
import { getSettings } from '../lib/settings'

declare global {
  interface Window {
    __readlingExtensionLookup?: (request: unknown) => Promise<ExtensionLookupResponse>
  }
}

/** Called in the trusted app tab by the extension; third-party web-page messages are never subscribed to. */
export function ExtensionLookupBridge() {
  useEffect(() => {
    const bridge = createExtensionLookupHandler({
      settings: getSettings,
      explain: (request, signal) => explainWord(request, getSettings(), signal),
      save: async (request, explanation) => {
        const existing = await db.words.get(wordKey(request.language, request.term))
        if (!existing) await setWordStatus(request.language, request.term, 'learning', request.sentence)
        await saveExplanation(request.language, request.term, explanation, request.sentence, { id: request.url, title: request.title, url: request.url })
      },
    })
    window.__readlingExtensionLookup = bridge.handle
    return () => {
      if (window.__readlingExtensionLookup === bridge.handle) delete window.__readlingExtensionLookup
      bridge.dispose()
    }
  }, [])
  return null
}
