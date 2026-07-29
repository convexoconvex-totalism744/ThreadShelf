/**
 * Bug-hunting tests for the chunker. We test boundary conditions for
 * splitting, overlap math, role detection, and unusual turn shapes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkTurns } from '../src/chunking.js';

describe('chunkTurns — boundary behaviour', () => {
  it('treats undefined-only turns as their detected role with empty text → skipped', () => {
    const out = chunkTurns([{}], { sourceFile: 'x.json' });
    assert.deepStrictEqual(out, []);
  });

  it('keeps turnIndex monotonic even when intermediate turns are skipped', () => {
    const out = chunkTurns([
      { user: '[image]' },
      { ai: 'real reply' },
      { user: '' },
      { thinking: 'second' },
    ], { sourceFile: 'src.json' });
    assert.deepStrictEqual(out.map((c) => c.turnIndex), [1, 3]);
    assert.deepStrictEqual(out.map((c) => c.role), ['ai', 'thinking']);
  });

  it('does not split when text exactly equals MAX_CHUNK_CHARS (default 2000)', () => {
    const text = 'x'.repeat(2000);
    const out = chunkTurns([{ user: text }], { sourceFile: 's.json' });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].text.length, 2000);
  });

  it('splits when text exceeds MAX_CHUNK_CHARS', () => {
    const text = 'x'.repeat(5000);
    const out = chunkTurns([{ user: text }], { sourceFile: 's.json' });
    assert.ok(out.length >= 3, `expected ≥3 chunks, got ${out.length}`);
    // Every chunk must contain only the expected character → no off-by-one corruption.
    for (const chunk of out) assert.ok(/^x+$/.test(chunk.text));
  });

  it('prefers paragraph break for cleaner splits (first chunk ends at the break)', () => {
    const long = 'lorem '.repeat(300) + '\n\n' + 'ipsum '.repeat(50);
    const out = chunkTurns([{ ai: long }], { sourceFile: 's.json' });
    assert.ok(out.length >= 2);
    // The first chunk should end on a "lorem" boundary (no "ipsum" content).
    assert.ok(!out[0].text.includes('ipsum'));
    // The full corpus must still be discoverable across the chunk set.
    assert.ok(out.some((chunk) => chunk.text.includes('ipsum')));
  });

  it('produces chunks that never include empty strings', () => {
    const text = '\n\n\n\n' + 'a'.repeat(2500) + '\n\n\n\n';
    const out = chunkTurns([{ ai: text }], { sourceFile: 's.json' });
    for (const chunk of out) assert.ok(chunk.text.trim().length > 0);
  });

  it('passes the sourceFile through unchanged', () => {
    const out = chunkTurns([{ user: 'Hi' }], { sourceFile: '/abs/path/file.json' });
    assert.strictEqual(out[0].sourceFile, '/abs/path/file.json');
  });

  it('terminates even for pathological all-whitespace text', () => {
    const text = '\n'.repeat(10_000);
    // chunkTurns should produce zero output (each chunk trims to empty).
    const out = chunkTurns([{ ai: text }], { sourceFile: 's.json' });
    assert.deepStrictEqual(out, []);
  });

  it('chunks user/thinking/ai with the right roles in mixed order', () => {
    const out = chunkTurns([
      { user: 'Q1' },
      { thinking: 'T1' },
      { ai: 'A1' },
      { user: 'Q2' },
    ], { sourceFile: 's.json' });
    assert.deepStrictEqual(out.map((c) => c.role), ['user', 'thinking', 'ai', 'user']);
  });
});
