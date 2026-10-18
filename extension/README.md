# readling browser extension

"Read this page in readling": sends the article you're on to readling with one click.

- Click the toolbar button: readling opens the page's main text (menus, ads and footers are left out).
  If you've selected a passage, just that passage is sent.
- Or right-click: **Read this page in readling** / **Read the selection in readling**.

readling then shows a preview with the detected language and how hard the text is for you. Press **Start reading**.

## Install (Chrome, Edge, Brave)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension` folder.
3. Open the extension's **Options** and enter where readling runs for you.
   The default is `http://localhost:5173/` (`npm run dev`). For a hosted copy, enter its address
   and allow access when Chrome asks.

## Privacy

The extension reads a page only when you click it. The text goes straight from that tab to the readling tab it
opens. Nothing is sent to any server, and the extension has no analytics.

## How it works

- `extract.js` runs [Mozilla Readability](https://github.com/mozilla/readability) (Apache-2.0, vendored in
  `vendor/`) on a copy of the page and turns the result into plain paragraphs.
- `background.js` opens `<your readling>/#/import` and leaves the text on that page
  (`window.__readlingImport`, plus a `readling:import` event), where readling's import screen picks it up.
