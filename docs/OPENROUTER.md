# OpenRouter Export

OpenRouter does not provide a bulk export. ThreadShelf therefore includes two
browser-console scripts that export your OpenRouter chats into parser-compatible
JSON:

```text
scripts/openrouter-export-all.js       # every chat in the sidebar, one file each
scripts/openrouter-export-browser.js   # just the chat currently open
```

The DOM selectors both scripts rely on (sidebar `a[href*="room="]`, message
`[data-testid="user-message"|"assistant-message"]`, body `[data-dd-privacy="hidden"]`,
model `img[alt^="Favicon for"]`) are pinned to OpenRouter's chat UI as of 2026-06
and covered by `test/playwright/openrouter-export.spec.js`. If OpenRouter changes
its markup and a script finds no chats, update that test (and the selectors) first.

## Quick Steps (all chats)

1. Open [openrouter.ai](https://openrouter.ai/) signed in, with the chat list visible.
2. Open DevTools Console (`F12`).
3. Paste the entire contents of `scripts/openrouter-export-all.js`, press Enter.
4. Allow "multiple downloads" if prompted. The script clicks each chat, scrolls to
   load its full history, and downloads one JSON per chat.
5. Move the downloaded files into a folder and index that folder.

The rest of this document describes the single-chat flow and the extraction
internals (they apply to bulk mode too, since bulk just repeats them per chat).

## What The Script Does

The script runs inside the OpenRouter chat page in your browser. It does not call the ThreadShelf server and it does not use an OpenRouter API key.

At a high level it:

1. Looks for visible message nodes in the current page DOM.
2. Detects message role: `user` or `assistant`.
3. Extracts visible text from paragraphs, list items, headings, code blocks, or fallback text.
4. Tries to detect assistant model metadata from nearby DOM attributes/classes.
5. Deduplicates identical role/content pairs.
6. Builds a JSON payload with `platform: "openrouter"` and `turns[]`.
7. Creates a browser `Blob`.
8. Creates a temporary download link.
9. Automatically downloads `openrouter-export-<timestamp>.json`.

Output shape:

```json
{
  "platform": "openrouter",
  "exportedAt": "2026-05-24T12:00:00.000Z",
  "pageTitle": "OpenRouter chat title",
  "sourceUrl": "https://openrouter.ai/chat/...",
  "turns": [
    {
      "role": "user",
      "content": "User message text"
    },
    {
      "role": "assistant",
      "content": "Assistant message text",
      "model": "optional/model-name"
    }
  ]
}
```

ThreadShelf detects this via:

```json
{ "platform": "openrouter" }
```

and parses `turns[]`.

## Single Chat Export: Exact Steps

1. Open OpenRouter in your browser.
2. Go to the exact chat you want to export:

```text
https://openrouter.ai/chat/<chat-id>
```

3. Scroll upward until the full conversation history is loaded.

This is important. The script can only export messages that exist in the current browser DOM. If OpenRouter lazy-loads old messages and you do not scroll to load them, the downloaded JSON will be incomplete.

4. Open DevTools Console.

Common shortcuts:

- Chrome / Edge / Brave on Windows: `F12`, then Console tab.
- Chrome / Edge / Brave on macOS: `Option+Command+J`.
- Firefox on Windows: `Ctrl+Shift+K`.
- Firefox on macOS: `Option+Command+K`.

5. Open `scripts/openrouter-export-browser.js` in this repository.
6. Copy the entire script.
7. Paste it into the DevTools Console on the OpenRouter chat page.
8. Press Enter.
9. The browser should download a JSON file named like:

```text
openrouter-export-2026-05-24T12-00-00-000Z.json
```

10. Move that JSON into a folder you want to index.
11. In ThreadShelf, create/select an `openrouter` collection.
12. Index the folder.
13. Search a phrase from the exported chat.
14. Open a result and verify the full thread.

## Browser Warning About Pasting Code

Some browsers show a warning before allowing pasted code in DevTools. This is normal browser protection against malicious copy/paste attacks.

Only paste scripts you have read and trust. This script is local in the repository and should be reviewed before use.

## Bulk Export Limitations

`openrouter-export-all.js` visits the chat links currently exposed in the
sidebar, loads each conversation, and downloads one JSON file per chat. It is a
working bulk exporter, but it remains tied to OpenRouter's undocumented UI.

Current limitations:

- Sidebar virtualization or pagination may hide chats from the script.
- Interrupted runs do not resume automatically.
- Failed chats are logged but not retried.
- Downloads are separate JSON files rather than one archive.
- There is no manifest of previous runs.

## Common Problems

No messages found:

- You may not be on a chat page.
- OpenRouter DOM selectors may have changed.
- Messages may not be loaded yet.
- Try scrolling and running the script again.

Downloaded JSON has too few messages:

- You probably did not scroll far enough to load older messages.
- Reopen the chat, scroll to the beginning, export again.

Roles look wrong:

- The script infers roles from DOM attributes, ARIA labels, and text fallback.
- OpenRouter UI changes can break this.
- Create a tiny anonymized fixture with the same output shape and add a parser/UI test if needed.

Model is missing:

- Model detection is best-effort.
- Search still works without model metadata.

DevTools refuses paste:

- Follow the browser prompt to allow pasting only if you trust the script.

## Safety Notes

- The script runs in your browser on the OpenRouter page.
- It exports visible chat content into a local JSON download.
- It does not send data to ThreadShelf automatically.
- It does not send data to any third-party endpoint.
- It does not ask for passwords, tokens, or API keys.
- You decide where to store and index the downloaded JSON.

## Safety Boundaries

- Do not ask for OpenRouter passwords.
- Do not ask for API keys.
- Do not bypass account security.
- Do not scrape data the user cannot already see in their browser.

## Validation After Export

After exporting a chat:

```bash
npm run parse -- path/to/openrouter-export.json
```

Then index the folder in the UI and run:

- One exact phrase search.
- One semantic search.
- One thread-open check.
- One collection stats check.
