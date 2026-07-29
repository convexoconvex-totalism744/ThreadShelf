# Real Data Testing

Use this checklist to validate real private exports without leaking data into git.

## Rules

- Do not commit real exports.
- Do not commit `.lancedb/`, `.uploads/`, `.collections.json`, logs, or temp folders.
- Use throwaway collections for destructive tests.
- If a real export breaks parsing, create a tiny anonymized fixture with the same JSON shape.

## Preparation

Run:

```bash
npm test
npm run test:e2e
npm start
```

Open:

```text
http://localhost:3000
```

Create test collections:

- `real_ai_studio_test`
- `real_chatgpt_test`
- `real_claude_test`
- `real_openrouter_test`
- `real_lmstudio_test`
- `real_grok_test`

## Provider Checks

Google AI Studio:

- Index one small export folder.
- Index a larger export folder.
- Search a unique phrase.
- Open a thread and verify turn order.

ChatGPT / OpenAI:

- Index `conversations.json` or the current exported JSON structure.
- Search for a unique prompt.
- Search for a semantic paraphrase.
- Verify assistant responses and user prompts both appear when filters allow them.

Claude / Anthropic:

- Index a real export folder or JSON file set.
- Verify both `conversations.json` and per-project conversation files are discovered.
- Search a known phrase.
- Verify long conversations reconstruct correctly.

OpenRouter:

- Export one chat using `scripts/openrouter-export-browser.js`.
- Index the downloaded JSON.
- Verify model/source metadata if present.

LM Studio:

- Index a copy of `.lmstudio/conversations/`, never the live folder in a destructive test.
- Open a chat with regenerated answers and verify only `currentlySelected` is shown.
- Verify thinking is separate from the final answer and status/debug/citation blocks are absent.
- Verify the model label belongs to the selected answer version.

Grok:

- Index `prod-grok-backend.json` from an account export.
- Verify extended-JSON timestamps are normalized.
- Verify reasoning traces, user prompts, and final answers appear in source order.

## Unicode Checks

Search for real terms when available:

- Polish: `zażółć`, `gęślą`, `Łódź`.
- Spanish: `contraseña`, `¿Qué tal?`.
- Chinese: `漢字`, `中文`.
- Japanese: `日本語`, `こんにちは`.
- Arabic: `مرحبا`.
- Emoji or symbols if they exist in your archive.

## Collection Checks

- Stats should show files and chunks above zero after ingest.
- Switching collections should reset or clearly scope old search results.
- `All` should show results with the correct source collection label.
- Clear only a throwaway collection.
- Delete only a throwaway collection.
- Reindex the same folder with clear-first enabled and confirm results are not duplicated.

## Thread Checks

- Open at least three results per provider.
- Confirm source thread order is correct.
- Confirm copied conversation text is usable.
- Confirm source file and model metadata are plausible.

## Upload Checks

- Upload a nested folder and verify indexed file paths preserve useful structure.
- Upload malformed JSON and confirm the app reports an error without crashing.
- Upload a folder containing metadata JSON and confirm irrelevant files are skipped or safely reported.

## Performance Notes

Record rough numbers:

- Provider.
- Files.
- Chunks.
- Ingest time.
- Search latency if visible.
- Memory usage if the archive is large.
- Any failed files.

Test sizes:

- 10 files.
- 100 files.
- One larger real folder.

## If Something Fails

Do not commit the real file. Instead:

1. Copy only the structural shape needed to reproduce the bug.
2. Replace private text with synthetic text.
3. Add the fixture under `test/fixtures/`.
4. Document the pinned shape in `test/fixtures/README.md`.
5. Add a failing unit or E2E test.
6. Fix the parser, ingest, or UI behavior.
7. Run `npm run check`.
