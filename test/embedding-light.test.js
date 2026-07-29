import { describe, it } from 'node:test';
import assert from 'node:assert';
import { embed, getDimension } from '../src/embedding.js';

describe('embedding lightweight behavior', () => {
  it('exposes the configured vector dimension', () => {
    assert.strictEqual(getDimension(), 384);
  });

  it('returns immediately for an empty batch without loading a model', async () => {
    assert.deepStrictEqual(await embed([]), []);
  });
});
