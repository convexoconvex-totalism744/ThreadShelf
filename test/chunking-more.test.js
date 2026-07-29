import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkTurns, isIndexableText } from '../src/chunking.js';

describe('isIndexableText', () => {
  it('rejects nullish, empty, and one-character values', () => {
    for (const value of [undefined, null, '', ' ', '\n\t', 'a', ' x ']) {
      assert.strictEqual(isIndexableText(value), false);
    }
  });

  it('rejects the exact image placeholder and trimmed technical artifact forms', () => {
    for (const value of ['[image]', '{}', ' [] ', '<', ' Search(foo)', 'search(\n']) {
      assert.strictEqual(isIndexableText(value), false, value);
    }
  });

  it('accepts near misses and two-character content', () => {
    for (const value of ['ok', ' [image] ', '[Image]', '[image] caption', '{} extra', 'research(foo)', '<<']) {
      assert.strictEqual(isIndexableText(value), true, value);
    }
  });
});

describe('chunkTurns additional splitting and metadata cases', () => {
  it('preserves all optional metadata on every chunk', () => {
    const text = 'x'.repeat(2100);
    const chunks = chunkTurns(
      [
        {
          ai: text,
          model: 'model-x',
          createdAt: '2026-06-15T00:00:00.000Z',
          createdInThreadShelf: true,
          generationProvider: 'llama-cpp',
        },
      ],
      { sourceFile: 'chat.json', conversationKey: 'openai:1', title: 'Synthetic' },
    );
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.strictEqual(chunk.sourceFile, 'chat.json');
      assert.strictEqual(chunk.conversationKey, 'openai:1');
      assert.strictEqual(chunk.title, 'Synthetic');
      assert.strictEqual(chunk.model, 'model-x');
      assert.strictEqual(chunk.createdAt, '2026-06-15T00:00:00.000Z');
      assert.strictEqual(chunk.createdInThreadShelf, true);
      assert.strictEqual(chunk.generationProvider, 'llama-cpp');
    }
  });

  it('uses the default 100-character overlap for hard splits', () => {
    const text = Array.from({ length: 4200 }, (_, index) =>
      String.fromCharCode(65 + (index % 26)),
    ).join('');
    const chunks = chunkTurns([{ user: text }], { sourceFile: 'chat.json' });
    assert.ok(chunks.length >= 3);
    assert.strictEqual(chunks[1].text.slice(0, 100), text.slice(1900, 2000));
    assert.strictEqual(chunks[2].text.slice(0, 100), text.slice(3800, 3900));
  });

  it('prefers the latest line break inside the chunk boundary', () => {
    const text = `${'a'.repeat(1500)}\n${'b'.repeat(700)}`;
    const chunks = chunkTurns([{ ai: text }], { sourceFile: 'chat.json' });
    assert.strictEqual(chunks[0].text, 'a'.repeat(1500));
    assert.ok(chunks[1].text.startsWith('a'.repeat(99)));
    assert.ok(chunks[1].text.includes('b'.repeat(100)));
  });

  it('prefers a paragraph break over a later single newline', () => {
    const text = `${'a'.repeat(1000)}\n\n${'b'.repeat(500)}\n${'c'.repeat(700)}`;
    const chunks = chunkTurns([{ thinking: text }], { sourceFile: 'chat.json' });
    assert.strictEqual(chunks[0].text, 'a'.repeat(1000));
    assert.ok(chunks.some((chunk) => chunk.text.includes('c'.repeat(100))));
  });

  it('preserves whitespace when text fits in a single chunk', () => {
    const chunks = chunkTurns(
      [{ user: '  first line\n\nsecond line  ' }],
      { sourceFile: 'chat.json' },
    );
    assert.deepStrictEqual(chunks.map((chunk) => chunk.text), ['  first line\n\nsecond line  ']);
  });

  it('uses user precedence when malformed turns contain multiple role fields', () => {
    const chunks = chunkTurns(
      [{ user: 'user text', thinking: 'thinking text', ai: 'ai text' }],
      { sourceFile: 'chat.json' },
    );
    assert.deepStrictEqual(chunks.map(({ role, text }) => ({ role, text })), [
      { role: 'user', text: 'user text' },
    ]);
  });

  it('uses thinking precedence over ai when user is absent', () => {
    const chunks = chunkTurns(
      [{ thinking: 'thinking text', ai: 'ai text' }],
      { sourceFile: 'chat.json' },
    );
    assert.strictEqual(chunks[0].role, 'thinking');
    assert.strictEqual(chunks[0].text, 'thinking text');
  });

  it('handles a very long single turn without losing its tail', () => {
    const text = `${'z'.repeat(20_000)}TAIL`;
    const chunks = chunkTurns([{ ai: text }], { sourceFile: 'chat.json' });
    assert.ok(chunks.length > 10);
    assert.ok(chunks.at(-1).text.endsWith('TAIL'));
    assert.ok(chunks.every((chunk) => chunk.text.length <= 2000));
  });

  it('keeps all chunks from one turn on the same turn index', () => {
    const chunks = chunkTurns(
      [{ user: 'x'.repeat(4100) }, { ai: 'final' }],
      { sourceFile: 'chat.json' },
    );
    assert.deepStrictEqual([...new Set(chunks.slice(0, -1).map((chunk) => chunk.turnIndex))], [0]);
    assert.strictEqual(chunks.at(-1).turnIndex, 1);
  });
});
