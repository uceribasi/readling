# Contributing to readling

Thanks for helping! Bug reports, ideas, translations and code are all welcome.

## Getting started

You need Node.js 22.18 or newer.

```bash
npm install
npm run dev      # app on http://localhost:5173
npm test         # unit tests (Vitest)
npm run lint     # oxlint
npm run build    # type check + production build
```

To try the AI features without paying for an API, run [Ollama](https://ollama.com) locally and pick **Ollama (local)** in Settings.

## Before you open a pull request

- Run `npm run lint`, `npm test`, `npm run build` and `npm audit --audit-level=moderate`. CI runs the same checks.
- Add or update tests for logic in `src/lib/` (tests live next to the code as `*.test.ts`).
- Keep pull requests focused: one feature or fix at a time.
- Describe what changed and how you checked it. For UI changes, a screenshot helps a lot.

## Project layout

| Path | What's there |
|---|---|
| `src/lib/` | Logic without UI: storage (`db.ts`), spaced repetition (`srs.ts`), text segmentation (`tokenize.ts`), phrases (`phrases.ts`), PDFs (`pdf.ts`, `pdfText.ts`), EPUB and Wikipedia imports, furigana and pinyin (`readings.ts`), tests (`quiz.ts`), stats, backups, settings and translations (`i18n.ts`) |
| `src/lib/ai/` | AI providers (including the browser's on-device AI), prompts, stories and rewrites |
| `src/locales/` | Interface strings, one file per language |
| `src/components/` | Shared UI: layout, word panel, reader parts |
| `src/pages/` | One file per screen |
| `bridge/` | The local bridge for coding-agent CLIs (plain Node, no dependencies) |
| `extension/` | The "Read this page in readling" browser extension (plain JavaScript, no build step) |

## Adding an interface language

Interface text lives in `src/locales/`, one file per language. English (`en.ts`) is the reference.

1. Copy `en.ts` to a new file named after the language code (e.g. `it.ts`), rename the export (`export const it: Messages = …`) and translate every string. Keep `{placeholders}` and the shortcut keys (`K`, `X`, `Esc`…) as they are.
2. Add the language and its own name to `UI_LOCALES` in `src/lib/locales.ts`.
3. Add a loader for it to `loaders` in `src/lib/i18n.ts`.

TypeScript tells you if a string is missing, and `npm test` checks the placeholders.

## Code style

- TypeScript, React function components and Tailwind classes. Shared class strings live in `src/components/ui.ts`.
- Prefer clear names over comments. Comment the *why* when it isn't obvious.
- Everything runs in the browser. Don't add a server or anything that sends user data somewhere the user didn't choose.

## Reporting bugs

Please include your browser, what you did, what you expected and what happened. If the AI is involved, say which provider and model you used. Never paste your API key.

Report security vulnerabilities using [SECURITY.md](SECURITY.md), rather than a public bug report. Release preparation is described in [docs/RELEASING.md](docs/RELEASING.md).
