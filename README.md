<div align="center">

<img src="public/favicon.svg" alt="" width="64" height="64">

# readling

**Learn languages by reading what you love.**

Read articles, EPUB books or text-based PDFs, click the words you don't know, and ask AI what each one means *in that sentence*.<br>
The words you're learning come back for spaced-repetition review and quick tests.

Open source · Runs in your browser · On-device AI or bring your own · No account, no app backend

[Features](#features) · [Quick start](#quick-start) · [AI providers](#ai-providers) · [Privacy](#privacy) · [Türkçe](README.tr.md)

<!-- TODO: add a "Live demo" link here once it's deployed. -->

</div>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/reader-pdf-dark.png">
  <img alt="A Spanish PDF open in readling. The word “escalera” is selected and the side panel explains it: staircase, a spiral staircase together with “de caracol”, with a grammar note and an example sentence." src="docs/screenshots/reader-pdf-light.png">
</picture>

## Why readling

readling brings reading, vocabulary and practice together in a static web app:

- **Your library stays in your browser.** No readling account or application server is required. You can use a hosted copy or host the static files yourself.
- **Choose where AI runs.** Use free on-device browser AI where supported, your own API key, Ollama, or a local coding-agent bridge. Browser AI availability depends on your browser, hardware and language pair; see [AI providers](#ai-providers).
- **Learn words in context.** Full AI explanations include the meaning in the selected sentence, grammar and an example. If only browser translation is available, you get word and sentence translations instead.
- **AI is optional for practice.** Reading, word tracking and review work without AI. Tests use the translations and source sentences already saved with your words.

## Features

### Read anything, look up any word

Paste an article, a story or song lyrics, or load a `.txt` file. New words are blue, words you're learning are yellow, and known words are left plain. Clicking an untracked word adds it to your learning list and, when AI is configured, requests an explanation. You can also mark words as known or ignored.

- **Multi-word phrases:** drag across 2–8 words in one sentence, such as "a pesar de" or "give up", to save them as one item. In the text reader, you can also extend a selection with `Shift+→` and press `1` to start learning it. Phrases you're learning are underlined when they appear again and can be reviewed and tested like words.
- **Sentence translation:** one click (or `T`) translates the selected word's sentence into your explanation language.
- **Listen along:** play or pause the text page, start from a selected sentence and change the reading speed. Sentence highlighting follows playback; word highlighting also works when the browser voice supplies word boundaries.
- **Furigana and pinyin:** optional readings above Japanese kanji and Chinese characters, calculated on your device.
- **Resume long texts:** text is split into pages of about 350 words, and readling remembers the last page you opened.
- **Finish one page at a time:** "Finished this page" marks only that page's remaining new words as known, records the reading and moves to the next page if there is one. Learning words keep their status. If there are no new words, you can still mark the page as read.
- **Live vocabulary coverage:** the library shows known and learning words for each text and updates when you change word statuses, including from the Words page or another text.
- **Personal difficulty:** once you have at least 100 known words in a language, text previews show the unfamiliar share and a label: *Easy*, *Good level*, *Challenging* or *Hard*.

<img alt="A German text in the reader with “Straßenbahn” selected; the panel shows “tram, streetcar”, its meaning in the sentence, a grammar note and an example." src="docs/screenshots/reader-text.png">

### Bring anything to read

- **EPUB books:** import a DRM-free EPUB. readling extracts chapters in order, along with the title, author and language when available. Books open in the text reader; the original book layout is not preserved.
- **Wikipedia:** search Wikipedia in the language you're learning and read any article, minus the reference sections.
- **Web articles:** with the [browser extension](extension/README.md) for Chrome, Edge and Brave, send the current article or selected passage to readling. Article extraction removes menus and ads where possible. Install the extension from the included `extension/` folder and set your readling URL in its options.
- **Stories at your level:** describe a topic, pick a level from A1 to C2, and the AI writes a short story, using the words you're learning if you like.
- **Simplify:** ask AI to rewrite the current text page or the whole text at an easier level. The rewrite is saved as a separate text, keeping the original. This is available in the text reader.

### PDFs keep their layout

PDFs retain their original page layout. readling uses the PDF's text layer for word and phrase selection, sentence translation and pronunciation. It joins words split across lines with a hyphen and uses line spacing to identify paragraph boundaries.

Pages render as you scroll. Distant pages release their rendered content to reduce memory use and render again when needed. Each page has its own finish button, including an option to record reading when all its words are already tracked.

PDFs need an extractable text layer: scanned images require OCR, which is not implemented. Password-protected PDFs are not supported.

| Capability | Text reader, including EPUB and web imports | PDF reader |
|---|---|---|
| Word and phrase tracking, AI explanations, sentence translation | Yes | Yes |
| Word and sentence pronunciation | Yes | Yes |
| Continuous page read-aloud | Yes | No |
| Furigana and pinyin | Inline and in the word panel | In the word panel |
| Saved page position, library vocabulary coverage and difficulty | Yes | No |
| AI simplification | Current page or whole text | No |

### All your words in one place

Search and filter every word you've looked up by language and status, including **weak** words you keep getting wrong. Each word shows the sentence you met it in, when it's due for review and how you've done in tests. You can export the list as CSV for Anki.

<img alt="The Words page filtered to Spanish words being learned, each with its translation, source sentence, review date and test accuracy." src="docs/screenshots/words.png">

### Review and test

- **Spaced repetition** uses [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) to schedule learning words and phrases. Undo the last answer if needed. When AI is configured, a review card with a saved sentence can fetch a missing explanation.
- **Mixed tests** combine four question types: meaning, reverse meaning, fill-in-the-blank and typing. Questions use your saved translations and source sentences, so available types depend on your vocabulary data. They make no AI calls.
  - Wrong options come from your own vocabulary and prefer the same part of speech.
  - Typed answers accept missing accents and a single typo in answers of at least five characters as close answers. Optional Arabic and Hebrew vowel marks do not count as mistakes.
- **Tests don't touch your review schedule.** One click sends the words you missed back to review.

<img alt="A multiple-choice test question asking what “lámpara” means; “lamp” is marked correct and the source sentence is shown." src="docs/screenshots/quiz.png">

### Progress you can see and share

A daily activity streak, reading and practice totals, a 30-day word-activity chart and a progress image to share or download. Reading, adding words, reviews and tests all count toward your streak.

The CEFR estimate is a rough indicator based on your known word forms, not a language assessment. It can help choose the level of an AI story.

<img alt="The progress page: a 20-day streak, 2,700 known Spanish words, an estimated level of A2 with 550 words to go to B1, and a chart of new words per day." src="docs/screenshots/stats.png">

<img alt="The shareable progress image: “Learning Spanish”, 20-day streak, 2,700 known words, level A2, 24,542 words read, with a small chart." src="docs/screenshots/share-card.png" width="600">

### And also

- **Pronunciation:** hear any word or sentence with your browser's built-in voices. No readling AI API key is needed. Installed local voices work offline; other voices may use your browser or operating system's speech service.
- **Installable and offline:** add readling to your home screen or dock like an app. Once a production build has loaded and cached its assets, saved texts, PDFs, vocabulary and practice are available offline. Cloud AI, Wikipedia and first-time model or Japanese dictionary downloads need a connection.
- **Keyboard-first:** see the [shortcuts](#keyboard-shortcuts) below.
- **Light and dark themes**, and a layout that works on phones.
- **Backups:** export texts, embedded PDF files, vocabulary (including saved explanations), review schedules, test results and activity to one JSON file. Settings, API keys and AI caches are excluded. Imports are validated before restoring and merge with existing data, retaining newer word progress and test history. readling also reminds you to back up. Transfer between devices is manual; automatic sync is not implemented.
- **A guided start:** pick your languages and an AI, then open a sample text.

### Supported languages

**18 reading languages:** English, German, Spanish, French, Italian, Portuguese, Dutch, Swedish, Polish, Russian, Ukrainian, Turkish, Japanese, Chinese, Korean, Arabic, Persian and Hebrew.

Japanese and Chinese use word segmentation without spaces. Arabic, Persian and Hebrew have right-to-left reading layouts and matching keyboard navigation. Optional Arabic and Hebrew vowel marks are normalized for word tracking and tests.

**5 interface languages:** English, Turkish, Spanish, German and Portuguese. Reading-language support does not guarantee that every AI provider or browser voice supports the same languages.

## Quick start

You'll need Node.js 22.18 or newer. Clone this repository using its **Code** button, or download and extract its ZIP, then open a terminal in the project folder.

```bash
npm ci
npm run dev
```

Open the URL it prints. Two sample texts (English and German) are ready in the library. Choose your reading and explanation languages, then go to **Settings** and configure an [AI provider](#ai-providers) for explanations, translations, stories and simplification. You can start reading and tracking words without AI.

### Development checks

```bash
npm run lint
npm run typecheck
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and localization details.

### Deploy

```bash
npm run build
```

Preview the production build locally with `npm run preview`. Deploy the complete `dist/` directory to a static host, including `kuromoji-dict/` for Japanese readings. Use HTTPS for hosted installs and offline support; localhost is suitable for local use.

To serve from a sub-path, such as a GitHub Pages project site, build with `npm run build -- --base=/readling/`. The [release guide](docs/RELEASING.md) covers publishing checks.

## AI providers

| Provider | What you need |
|---|---|
| **Browser AI** (free, on-device) | A browser exposing the supported Prompt and/or Translator APIs, such as a compatible desktop Chrome installation. Check availability in Settings; language pairs and hardware affect what is available. |
| **Anthropic (Claude)** | An API key and an accessible model. Settings also has a Workspace ID field for keys that require one. |
| **OpenRouter**, **OpenAI**, **Google Gemini** | An API key and a model ID available to your account. |
| **Ollama** (free, local) | A pulled model, with Ollama started so it accepts the app's origin: `OLLAMA_ORIGINS=http://localhost:5173 ollama serve` |
| **Custom** | An OpenAI-compatible Chat Completions endpoint and model ID; an API key if the endpoint requires one. The endpoint must allow requests from your app's origin. |
| **Claude Code, Codex, Antigravity** (experimental) | The CLI installed and signed in, plus the local bridge. See [below](#coding-agent-clis-experimental). |

Model IDs are editable in Settings. Choose a model available from your provider; a suggested name does not guarantee access. If you use a different local port or a hosted copy, update Ollama's allowed origin to match that URL.

### What browser AI can do

- **Translation:** the Translator API downloads language models on first use, when the requested pair is supported. Without a ready Prompt model, lookups provide word and sentence translations, without grammar notes or generated examples.
- **Full explanations:** explicitly download Gemini Nano from Settings. readling can generate an explanation directly or generate it in English and translate it into your explanation language when both capabilities are available.
- **Stories and simplification:** these require a ready Prompt model and support for the requested language. The app currently enables direct Prompt output in English, Spanish, German, French and Japanese.

Initial model downloads need a connection. Once the necessary models are available, browser AI runs on your device. A desktop Chrome installation alone does not guarantee that these APIs or languages are available.

### Coding-agent CLIs (experimental)

A web page can't start programs on your computer, so readling includes a tiny local **bridge** with no dependencies that runs the CLI for it:

```bash
npm run bridge
```

Pick the CLI under **CLI on this computer** in Settings and paste the pairing token the bridge prints.

<details>
<summary>How the bridge keeps your computer safe</summary>

- **Network:** it listens on `127.0.0.1:8787` only and rejects unexpected `Host` headers, which protects against DNS rebinding.
- **Authentication:** every request needs the pairing token, stored in `~/.config/readling/bridge-token` with mode 600. Browser requests must also come from an allowed origin. Add yours with `READLING_ORIGINS=https://your-site.example`.
- **Isolation:** each run happens in a fresh, empty temp folder, and the prompt is passed without a shell.
  - **Claude Code:** tools, MCP servers, hooks, slash commands, CLAUDE.md files and session saving are all off.
  - **Codex:** runs in a read-only sandbox, ignores your user config and saves nothing.
  - **Antigravity:** runs with its terminal sandbox on. The CLI has no switch to turn tools off entirely.
- **Limits:** request size, concurrency (2 runs) and run time (2 minutes) are capped. A run that hangs is killed together with any processes it started.
- **Configuration:** `READLING_BRIDGE_PORT`, `READLING_ORIGINS`, `READLING_BRIDGE_TOKEN`, `READLING_BRIDGE_TIMEOUT_MS`, and `READLING_CLAUDE_BIN` / `READLING_CODEX_BIN` / `READLING_AGY_BIN` for CLIs that aren't on your `PATH`.

</details>

> [!IMPORTANT]
> The bridge runs your installed CLI with your own sign-in. Check your provider's current terms for use from third-party apps, including [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) if you use Claude Code. The bridge does not change those terms. API-key providers are also available in Settings.

## Privacy

- **No backend.** There is no readling server and no telemetry.
- **Local storage.** Texts, PDFs, words and settings are stored in your browser (IndexedDB and localStorage).
- **Word explanations:** the selected word or phrase, its sentence, and your language choices go to the configured AI endpoint. Review cards can request a missing explanation for their saved sentence.
- **Sentence translations:** the selected sentence and source/target languages are sent when you request a translation.
- **Stories:** the topic, language, level, requested length and any practice words you choose are sent to the AI. **Simplification** sends the title, selected page or full text, language and target level.
- **Where AI runs:** built-in browser AI processes prompts on your device after its models are downloaded. Ollama uses your configured endpoint; agent integrations send prompts through the local bridge to your CLI and its provider. Cloud providers receive prompts directly from your browser. API keys are sent to the endpoint you configure for that provider.
- **Speech:** local voices work on your device. Non-local browser or operating-system voices may send the text being spoken to their speech service and may require a connection.
- **Imports.** EPUB files are read in your browser. Wikipedia searches go straight from your browser to Wikipedia. The extension hands pages to your readling tab and sends them nowhere else.
- **Furigana stays local.** The Japanese dictionary (about 18 MB) is served by readling itself and downloaded only when you turn furigana on. Pinyin needs no separate dictionary download.
- **Fewer requests.** Explanations and sentence translations are cached by content and target language, so an available cached result avoids another request. Words you already know aren't sent unless you ask.

Browser storage can be cleared, so export a backup from **Settings** now and then. Backups contain your reading material and learning history; keep them private. See [SECURITY.md](SECURITY.md) for vulnerability reports and [the release guide](docs/RELEASING.md) for publishing checks.

## Keyboard shortcuts

| Where | Keys |
|---|---|
| Selected word or phrase, in either reader | `1` learning · `K` known · `X` ignore · `S` listen · `E` explain · `T` translate the sentence · `Esc` close |
| Text reader | `←` `→` move between words · `Shift+→` extend selection · `Shift+←` shrink selection · `P` play/pause page read-aloud |
| Review | `Space` or `Enter` show answer · `1`–`4` grade · `Z` undo |
| Test | `1`–`4` pick an option · `Enter` submit a typed answer or continue |

Arrow directions are reversed for right-to-left texts. Keyboard phrase selection stays within one sentence and is limited to eight words; press `1` to add the selected phrase to your learning list.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Dexie (IndexedDB) · [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) · [pdf.js](https://mozilla.github.io/pdf.js/) · [fflate](https://github.com/101arrowz/fflate) · [kuromoji.js](https://github.com/takuyaa/kuromoji.js) · [pinyin-pro](https://github.com/zh-lx/pinyin-pro) · Anthropic SDK · Chrome's built-in AI APIs · vite-plugin-pwa · Vitest

The PDF library and the AI clients load only when they're needed, which keeps the first load small.

```
bridge/              local bridge for coding-agent CLIs
extension/           "Read this page in readling" browser extension
src/
  lib/
    ai/              provider clients (incl. on-device), prompts, stories and rewrites
    db.ts            IndexedDB schema, word and activity helpers
    srs.ts           FSRS scheduling
    tokenize.ts      paragraph, sentence and word segmentation
    phrases.ts       multi-word selection and phrase matching
    readings.ts      local furigana and pinyin annotations
    pdf.ts           opening PDFs, previews
    pdfText.ts       picking words and sentences from the PDF text layer
    quiz.ts          test questions and answer checking
    epub.ts          reading EPUB books
    wikipedia.ts     Wikipedia search and article text
    difficulty.ts    how hard a text is for you
    stats.ts         streaks and the level estimate
    shareCard.ts     the shareable progress image
    backup.ts        JSON backup export and merge
    backupValidation.ts  backup schema and embedded PDF validation
    i18n.ts          interface language loading and formatting
  locales/           interface translations (en, tr, es, de, pt)
  components/        layout, word panel, shared reader parts
  pages/             library, new text, import, readers, words, test, review, stats, settings
```

## Roadmap

The features above are implemented. Possible next additions:

- [ ] Look up words directly on web pages
- [ ] YouTube subtitle import
- [ ] OCR for scanned PDFs
- [ ] Optional sync between devices
- [ ] More interface languages

## Contributing

Issues and pull requests are welcome, especially new interface languages. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the project layout and how to add a language.

## License

[MIT](LICENSE)
