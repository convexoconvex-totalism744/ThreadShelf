# Synthetic export fixtures

Every fixture in this directory is synthetic and anonymized. Real exports are
used only to identify JSON structure and edge cases; private text, titles,
identifiers, paths, model locations, and attachments must never be copied here.

## Coverage

| Fixture                           | Format pinned by the snapshot                              |
| --------------------------------- | ---------------------------------------------------------- |
| `gemini-polish.json`              | Google AI Studio text chat with thinking                   |
| `gemini-imagen.json`              | Google AI Studio Imagen prompt history                     |
| `anthropic-polish.json`           | Anthropic `conversations.json`                             |
| `anthropic-project-snapshot.json` | Anthropic per-project conversation file                    |
| `openai-polish.json`              | ChatGPT active mapping branch                              |
| `openrouter-polish.json`          | ThreadShelf OpenRouter browser export                      |
| `lmstudio-polish.json`            | LM Studio multi-step answer with thinking                  |
| `lmstudio-snapshot.json`          | LM Studio answer without thinking                          |
| `lmstudio-versions-snapshot.json` | LM Studio alternative versions and technical steps         |
| `grok-polish.json`                | Grok account export with extended-JSON dates and reasoning |

The fixture assertions in `test/fixtures.test.js` compare complete normalized
turns, not just counts. Keep fixtures small while preserving the structural
feature that caused a regression. When a real export reveals a new shape,
replace all content and identifiers with obviously synthetic values before
adding the snapshot.
