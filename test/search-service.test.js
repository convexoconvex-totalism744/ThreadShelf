import { describe, it } from 'node:test';
import assert from 'node:assert';
import { searchResultComparator } from '../src/services/search.js';

const result = (document, distance) => ({
  id: document,
  document,
  distance,
  metadata: { sourceFile: 'fixture.json', role: 'ai', turnIndex: '0' },
});

describe('cross-collection search ranking', () => {
  it('orders by vector distance when keyword boost is disabled', () => {
    const rows = [result('far result', 0.7), result('near result', 0.1)];
    rows.sort(searchResultComparator('exact phrase', false));
    assert.deepStrictEqual(
      rows.map((row) => row.document),
      ['near result', 'far result'],
    );
  });

  it('keeps exact phrase matches boosted after collections are merged', () => {
    const rows = [
      result('semantically near result', 0.05),
      result('A farther EXACT PHRASE match', 0.5),
    ];
    rows.sort(searchResultComparator('exact phrase', true));
    assert.deepStrictEqual(
      rows.map((row) => row.document),
      ['A farther EXACT PHRASE match', 'semantically near result'],
    );
  });

  it('uses distance as the tie-breaker between equally boosted results', () => {
    const rows = [result('exact phrase farther', 0.6), result('exact phrase nearer', 0.2)];
    rows.sort(searchResultComparator('exact phrase', true));
    assert.deepStrictEqual(
      rows.map((row) => row.document),
      ['exact phrase nearer', 'exact phrase farther'],
    );
  });
});
