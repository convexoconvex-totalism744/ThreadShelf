import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkTurns } from '../src/chunking.js';

describe('chunkTurns', () => {
  it('preserves Polish text and role metadata', () => {
    const chunks = chunkTurns([
      { user: 'Zażółć gęślą jaźń w anonimowym pytaniu. 中文测试.' },
      { thinking: 'Myślę po polsku i zachowuję znaki. 日本語テスト.' },
      { ai: 'Odpowiedź zawiera łódź, ścieżkę i źródło. Español: acción. Emoji: 🧪.' },
    ], { sourceFile: 'anon-polish.json' });

    assert.deepStrictEqual(chunks.map((chunk) => chunk.role), ['user', 'thinking', 'ai']);
    assert.deepStrictEqual(chunks.map((chunk) => chunk.turnIndex), [0, 1, 2]);
    assert.strictEqual(chunks[0].text, 'Zażółć gęślą jaźń w anonimowym pytaniu. 中文测试.');
    assert.ok(chunks[1].text.includes('日本語'));
    assert.ok(chunks[2].text.includes('🧪'));
    assert.strictEqual(chunks[2].sourceFile, 'anon-polish.json');
  });

  it('skips image-only pseudo turns', () => {
    const chunks = chunkTurns([
      { user: '[image]' },
      { ai: 'Opis obrazu bez danych prywatnych.' },
    ], { sourceFile: 'image-export.json' });

    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].role, 'ai');
    assert.strictEqual(chunks[0].turnIndex, 1);
  });
});
