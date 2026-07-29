# Contributing

ThreadShelf is a local-first tool for private AI chat archives. Contributions should preserve privacy, keep the app simple, and include tests for behavior changes.

## Development Setup

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Test Commands

Run the smallest relevant set:

```bash
npm test
npm run test:e2e
npm run test:playwright
```

Use `npm test` for parser, chunking, validation, MCP protocol, and ingest unit changes.

Use `npm run test:e2e` for API, LanceDB, ingest, search, thread, and MCP stdio changes.

Use `npm run test:playwright` for UI, upload, collection, thread-reader, or browser workflow changes.

## Fixtures

Fixtures must be synthetic and anonymized. Do not commit real prompts, real assistant answers, account metadata, API keys, emails, names, or private project content.

When a real export breaks:

1. Preserve only the JSON shape needed to reproduce the bug.
2. Replace text with synthetic multilingual content.
3. Add a fixture under `test/fixtures/`.
4. Add a failing test.
5. Fix the behavior.

## Code Style

- ES modules.
- Two-space indentation.
- Semicolons.
- Single quotes.
- Keep reusable logic in `src/`.
- Keep HTTP-specific behavior in `src/routes/` and shared business logic in `src/services/`.
- Prefer structured parser logic over fragile string hacks.

## Pull Requests

Include:

- What changed.
- Why it changed.
- Commands run.
- Screenshots for UI changes.
- Notes about local data, LanceDB schema, environment variables, or privacy impact.

Before opening a PR:

- Check `git status --short --ignored`.
- Confirm no private exports or generated databases are tracked.
- Run `npm run check`.
- Update the relevant user-facing docs or issue when behavior changes.
