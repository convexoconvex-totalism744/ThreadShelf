import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../src/parser.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

const cases = [
  {
    name: 'Gemini multilingual fixture',
    file: 'gemini-polish.json',
    expected: [
      {
        user: 'Cześć, przygotuj anonimowy plan nauki. Uwzględnij: łódź, żółć, gęślą jaźń. 中文: 你好，测试搜索。日本語: こんにちは。Español: acción, niño, pingüino.',
      },
      {
        thinking:
          'Najpierw rozbijam prośbę na cele, ograniczenia i format odpowiedzi. العربية: مرحبا. Symbols: §, €, ™, ✓.',
        model: 'models/gemini-test',
      },
      {
        ai: 'Plan: 1. Zbierz materiały. 2. Ustal priorytety. 3. Sprawdź postępy po tygodniu. Emoji smoke: 🚀 🔒 🧪.',
        model: 'models/gemini-test',
      },
    ],
  },
  {
    // Anonymized snapshot of AI Studio's undocumented Imagen history shape.
    name: 'Gemini Imagen fixture',
    file: 'gemini-imagen.json',
    expected: [
      {
        user: 'Stwórz anonimową mapę ruin. Znaki testowe: zażółć, 漢字, 🔐.',
      },
      {
        ai: '[image]',
        model: 'models/imagen-test',
      },
      {
        user: 'Dodaj więcej zieleni i kamienny most.',
      },
      {
        ai: '[image]',
        model: 'models/imagen-test',
      },
    ],
  },
  {
    name: 'Anthropic multilingual fixture',
    file: 'anthropic-polish.json',
    expected: [
      {
        user: 'Wytłumacz różnicę między testem jednostkowym a integracyjnym. Dodaj japoński przykład: 東京でテストを書く.',
      },
      {
        ai: 'Test jednostkowy sprawdza małą funkcję w izolacji. Test integracyjny sprawdza współpracę kilku elementów. 中文例子：解析器和索引器一起工作。',
        model: 'claude-test',
      },
    ],
  },
  {
    // Current Anthropic exports store project conversations in individual files
    // with `messages[].content.content`, separate from `conversations.json`.
    name: 'Anthropic project-conversation snapshot',
    file: 'anthropic-project-snapshot.json',
    expected: [
      {
        user: 'Zaplanuj bezpieczny test parsera. Znaki: zażółć gęślą jaźń, 漢字, 🔐.',
        createdAt: '2026-06-10T08:00:00.000Z',
      },
      {
        ai: 'Użyj małego syntetycznego pliku i sprawdź role, daty oraz Unicode.',
        createdAt: '2026-06-10T08:02:00.000Z',
      },
    ],
  },
  {
    name: 'OpenAI multilingual fixture',
    file: 'openai-polish.json',
    expected: [
      {
        user: 'Napisz krótką notatkę o bezpieczeństwie eksportów rozmów. Dodaj: zażółć, contraseña, corazón, mañana.',
        createdAt: '2026-02-02T02:40:00.000Z',
      },
      {
        ai: 'Eksporty rozmów powinny być traktowane jak dane prywatne: usuń dane osobowe, hasła i identyfikatory. También conserva Unicode correctamente: ¿Qué tal? ¡Bien!',
        model: 'gpt-test-response',
        createdAt: '2026-02-02T02:40:01.000Z',
      },
    ],
  },
  {
    name: 'OpenRouter multilingual fixture',
    file: 'openrouter-polish.json',
    expected: [
      {
        user: 'Jak zanonimizować historię rozmów przed testami? Użyj: gęś, 数据, かな, español, مرحبا.',
      },
      {
        ai: 'Zastąp nazwy, maile, tokeny i ścieżki neutralnymi wartościami. Zachowaj strukturę formatu oraz reprezentatywne znaki: 漢字, ひらがな, ñ, ç, ü, 🔐.',
        model: 'openrouter/test-model',
      },
    ],
  },
  {
    // Snapshot shape from LM Studio 0.4.x (.lmstudio/conversations/*.conversation.json).
    // Format is undocumented/unstable; this fixture pins the shape we tested against.
    name: 'LM Studio multilingual fixture',
    file: 'lmstudio-polish.json',
    expected: [
      {
        user: 'Jak bezpiecznie eksportować historię? Dodaj: zażółć, 数据, かな, español, مرحبا.',
        createdAt: '2023-11-14T22:13:20.000Z',
      },
      {
        thinking: 'Rozbijam prośbę na kroki. 漢字 test.',
        model: 'lmstudio-test-model',
        createdAt: '2023-11-14T22:13:20.000Z',
      },
      {
        ai: 'Zastąp dane osobowe neutralnymi wartościami. Zachowaj Unicode: ñ, ç, ü, 🔐.',
        model: 'lmstudio-test-model',
        createdAt: '2023-11-14T22:13:20.000Z',
      },
    ],
  },
  {
    // Anonymized snapshot of a Grok (x.ai) account export (prod-grok-backend.json):
    // nested `conversations[].{conversation, responses[].response}` with MongoDB
    // extended-JSON timestamps and reasoning in `agent_thinking_traces`.
    name: 'Grok multilingual fixture',
    file: 'grok-polish.json',
    expected: [
      {
        user: 'Wyjaśnij, jak działa eksport Grok. Dodaj znaki: zażółć gęślą jaźń, 漢字, 🔐.',
        createdAt: '2026-02-13T16:26:40.000Z',
      },
      {
        thinking: 'Rozkładam pytanie na kroki. 中文测试。',
        model: 'grok-test-model',
        createdAt: '2026-02-13T16:27:40.000Z',
      },
      {
        ai: 'Eksport Grok to JSON z polami conversations i responses. Unicode: ñ, ç, ü, 日本語.',
        model: 'grok-test-model',
        createdAt: '2026-02-13T16:27:40.000Z',
      },
    ],
  },
  {
    // Anonymized snapshot of a REAL LM Studio 0.4.x file: assistant multiStep with a
    // single answer contentBlock (no "thinking" step) plus a debugInfoBlock that must
    // be skipped; user message has `edited: true`. Mirrors the exact shape we hit.
    name: 'LM Studio real-shape fixture (no thinking step)',
    file: 'lmstudio-snapshot.json',
    expected: [
      {
        user: 'Napisz krótki wiersz o kodzie. Znaki: zażółć gęślą jaźń, 漢字, 🔐.',
        createdAt: '2026-01-25T15:15:10.330Z',
      },
      {
        ai: 'Kod płynie jak rzeka nocą; ñ, ç, ü, 日本語.',
        model: 'llama-test-model',
        createdAt: '2026-01-25T15:15:10.330Z',
      },
    ],
  },
  {
    // Real LM Studio histories can keep 2-4 alternative assistant versions and
    // technical status/citation/debug steps. Only `currentlySelected` is a turn.
    name: 'LM Studio selected-version snapshot',
    file: 'lmstudio-versions-snapshot.json',
    expected: [
      {
        user: 'Wybierz aktywną wersję odpowiedzi. Znaki: zażółć gęślą jaźń, 日本語, 🔐.',
        createdAt: '2026-02-08T00:00:00.000Z',
      },
      {
        thinking: 'Sprawdzam wybraną wersję bez ujawniania prywatnych danych.',
        model: 'selected-test-model',
        createdAt: '2026-02-08T00:00:00.000Z',
      },
      {
        ai: 'To jest aktywna odpowiedź: ñ, ç, ü, 中文.',
        model: 'selected-test-model',
        createdAt: '2026-02-08T00:00:00.000Z',
      },
    ],
  },
];

describe('anonymized export fixtures', () => {
  for (const testCase of cases) {
    it(`parses ${testCase.name}`, async () => {
      const result = await parseFile(join(fixturesDir, testCase.file));
      assert.strictEqual(result.error, undefined);
      assert.deepStrictEqual(result.turns, testCase.expected);
    });
  }

  it('preserves representative Unicode across all fixture formats', async () => {
    const parsed = await Promise.all(
      cases.map((testCase) => parseFile(join(fixturesDir, testCase.file))),
    );
    const corpus = parsed
      .flatMap((result) => result.turns)
      .map((turn) => turn.user || turn.thinking || turn.ai || '')
      .join('\n');

    for (const token of [
      'łódź',
      '你好',
      'こんにちは',
      '東京',
      'contraseña',
      '¿Qué tal?',
      'مرحبا',
      '漢字',
      '🔐',
      '🚀',
    ]) {
      assert.ok(corpus.includes(token), `Missing Unicode token: ${token}`);
    }
  });
});
