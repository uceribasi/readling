# readling browser extension

"Read this page in readling": sends the article you're on to readling with one click.

- Click the toolbar button: readling opens the page's main text (menus, ads and footers are left out).
  If you've selected a passage, just that passage is sent.
- Or right-click: **Read this page in readling** / **Read the selection in readling**.
- Select a word or short phrase and right-click **Explain selected word in readling**. An explanation
  appears directly on the source page; **Save word to readling** adds it to your vocabulary with its
  source sentence and link. Existing learning/known/ignored status is preserved.

readling then shows a preview with the detected language and how hard the text is for you. Press **Start reading**.

Word explanations use your AI provider and explanation language configured inside readling. The extension
uses an open tab at the exact configured readling address, preferring an active tab and then the most
recently used one. If none is open, it opens a background tab. Reload an older readling tab after updating
the app. The word's language comes from the source page, falling back to readling's last text language.
Save the word within five minutes of explaining it; explain again if the app tab was closed or reloaded.

## Install (Chrome, Edge, Brave)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension` folder.
3. Open the extension's **Options** and enter where readling runs for you.
   The default is `http://localhost:5173/` (`npm run dev`). For a hosted copy, enter its address
   and allow access when Chrome asks.

## Privacy

The extension reads a page only when you click it. Article imports go straight from that tab to the readling
tab. When you explicitly request a word explanation, the selected phrase and a small amount of surrounding
text go to the AI provider you configured in readling (or your chosen local model). API keys stay inside
readling; they are never copied into the extension or source page. The extension has no analytics.

There are no automatic content scripts and no new all-sites permission. `activeTab` grants temporary source
page access for your action; only the configured readling origin needs persistent host permission. Source
content and AI responses are displayed with `textContent` inside an isolated popup, never as HTML. Closing
the popup does not cancel an AI request already sent. Tab-routing metadata expires after five minutes and
is stored in browser-session storage so the Save button survives extension service-worker suspension.

## How it works

- `extract.js` runs [Mozilla Readability](https://github.com/mozilla/readability) (Apache-2.0, vendored in
  `vendor/`) on a copy of the page and turns the result into plain paragraphs.
- `background.js` opens `<your readling>/#/import` and leaves the text on that page
  (`window.__readlingImport`, plus a `readling:import` event), where readling's import screen picks it up.
- The word action makes a one-shot `MAIN`-world call to `window.__readlingExtensionLookup` in the chosen
  app tab. The app validates a bounded, timestamped request and returns only educational fields. No
  `postMessage` or arbitrary web-page message listener can trigger AI calls. The save action is bound to
  the originating extension, source tab, URL, request ID, and the explanation cached inside that app tab.
