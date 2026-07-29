# Changelog

All notable changes to ThreadShelf are documented here.

## 1.0.0 — 2026-07-26

Initial public release.

### Archive and search

- Normalize exports from Google AI Studio, ChatGPT/OpenAI, Claude/Anthropic,
  OpenRouter, LM Studio, and Grok/xAI.
- Generate multilingual embeddings locally and store vectors plus normalized
  thread snapshots in LanceDB.
- Search semantically or by exact substring, filter roles/dates/models/origin,
  browse complete conversations, pin threads, and save searches.
- Ingest from the UI or CLI, including cancellable runs and watch-folder mode.
- Query the same local index through the HTTP API, CLI, or MCP stdio server.

### Experimental generation

- Start local chats or continue imported threads through managed, loopback-only
  `llama.cpp` with streamed output and runtime diagnostics.
- Optionally use the clearly marked external OpenRouter provider with live model
  discovery and routing controls.
- Persist completed chats locally by default; provide a separate tab-scoped
  private mode and unsaved recovery cards for failed/stopped streams.

### Safety and quality

- Keep generation control, filesystem browsing, and saved-chat routes
  loopback-only.
- Store OpenRouter session keys in process memory and exclude archived thinking
  from provider context.
- Cover parser, API, MCP, production UI, repository hygiene, and documentation
  links in the automated test gate.
