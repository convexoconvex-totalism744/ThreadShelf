import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MAX_QUERY_CHARS,
  MAX_SEARCH_N,
  ValidationError,
  normalizeCollectionName,
  normalizeCollectionSelector,
  assertDeletableCollection,
  assertClearableCollection,
  normalizeQuery,
  normalizeCount,
  normalizeRoles,
  normalizeOptionalString,
  normalizeBoolean,
  normalizeSearchMode,
  validateTurn,
  validateTurns,
  isSafeRelativePath,
} from '../src/validation.js';

const captureValidationError = (fn) => {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ValidationError);
  return caught;
};

describe('validation errors and collection edge cases', () => {
  it('preserves the custom error name and field', () => {
    const error = new ValidationError('bad value', { field: 'custom' });
    assert.strictEqual(error.name, 'ValidationError');
    assert.strictEqual(error.message, 'bad value');
    assert.strictEqual(error.field, 'custom');
  });

  it('accepts collection names at the 63-character boundary', () => {
    const value = `a${'b'.repeat(62)}`;
    assert.strictEqual(normalizeCollectionName(value), value);
  });

  it('collapses repeated separators and trims edge separators', () => {
    assert.strictEqual(normalizeCollectionName('__Foo___Bar__'), 'foo_bar');
    assert.strictEqual(normalizeCollectionName('--foo--bar--'), 'foo--bar');
  });

  it('normalizes unicode and punctuation into separators', () => {
    assert.strictEqual(normalizeCollectionName('Żółć 東京 Project'), 'project');
    assert.strictEqual(normalizeCollectionName('alpha—beta'), 'alpha_beta');
  });

  it('stringifies primitive collection values', () => {
    assert.strictEqual(normalizeCollectionName(123), '123');
    assert.strictEqual(normalizeCollectionName(true), 'true');
  });

  it('reports a caller-provided field for collection failures', () => {
    const error = captureValidationError(() =>
      normalizeCollectionName(undefined, { field: 'target' }),
    );
    assert.strictEqual(error.field, 'target');
    assert.match(error.message, /target/);
  });

  it('uses a caller-provided selector default verbatim but rejects whitespace-only values', () => {
    assert.throws(
      () => normalizeCollectionSelector('   ', { defaultValue: 'archive' }),
      ValidationError,
    );
    assert.strictEqual(
      normalizeCollectionSelector(undefined, { defaultValue: 'archive' }),
      'archive',
    );
  });

  it('normalizes selector whitespace and casing around all', () => {
    assert.strictEqual(normalizeCollectionSelector('  AlL  '), 'all');
  });

  it('returns normalized names from delete and clear guards', () => {
    assert.strictEqual(assertDeletableCollection(' My Project '), 'my_project');
    assert.strictEqual(assertClearableCollection(' Chunks '), 'chunks');
  });

  it('marks protected collection failures with collection field', () => {
    const error = captureValidationError(() => assertDeletableCollection('chunks'));
    assert.strictEqual(error.field, 'collection');
  });
});

describe('query, count, role, and optional string boundaries', () => {
  it('accepts a query exactly at the default length cap', () => {
    const query = 'q'.repeat(MAX_QUERY_CHARS);
    assert.strictEqual(normalizeQuery(query), query);
  });

  it('applies the length cap after trimming', () => {
    assert.strictEqual(normalizeQuery('  abc  ', { maxLength: 3 }), 'abc');
    assert.throws(() => normalizeQuery(' abcd ', { maxLength: 3 }), ValidationError);
  });

  it('uses custom query fields in errors', () => {
    const error = captureValidationError(() =>
      normalizeQuery('', { field: 'searchTerm' }),
    );
    assert.strictEqual(error.field, 'searchTerm');
    assert.match(error.message, /searchTerm/);
  });

  it('accepts scientific, hexadecimal, and padded integer count strings', () => {
    assert.strictEqual(normalizeCount(' 5 '), 5);
    assert.strictEqual(normalizeCount('1e1'), 10);
    assert.strictEqual(normalizeCount('0x10'), 16);
  });

  it('accepts custom inclusive count bounds', () => {
    assert.strictEqual(normalizeCount(0, { min: 0, max: 2 }), 0);
    assert.strictEqual(normalizeCount(2, { min: 0, max: 2 }), 2);
  });

  it('uses the exported maximum search count', () => {
    assert.strictEqual(normalizeCount(MAX_SEARCH_N), MAX_SEARCH_N);
    assert.throws(() => normalizeCount(MAX_SEARCH_N + 1), ValidationError);
  });

  it('rejects numeric strings that coerce to non-integers or non-finite values', () => {
    for (const value of ['1.01', 'Infinity', '-Infinity', 'NaN']) {
      assert.throws(() => normalizeCount(value), ValidationError);
    }
  });

  it('reports custom count fields for missing and out-of-range values', () => {
    for (const fn of [
      () => normalizeCount(undefined, { field: 'limit' }),
      () => normalizeCount(9, { max: 8, field: 'limit' }),
    ]) {
      const error = captureValidationError(fn);
      assert.strictEqual(error.field, 'limit');
    }
  });

  it('accepts every allowed role in mixed case and preserves first-seen order', () => {
    assert.deepStrictEqual(
      normalizeRoles([' AI ', 'User', 'thinking', 'ai']),
      ['ai', 'user', 'thinking'],
    );
  });

  it('stringifies non-string array role entries before validation', () => {
    for (const value of [['user', null, 'ai'], [undefined], [42]]) {
      assert.throws(() => normalizeRoles(value), ValidationError);
    }
  });

  it('returns null for role arrays containing only blank strings', () => {
    assert.strictEqual(normalizeRoles(['', '   ', '\n']), null);
  });

  it('reports custom role fields', () => {
    const error = captureValidationError(() =>
      normalizeRoles('system', { field: 'roleFilter' }),
    );
    assert.strictEqual(error.field, 'roleFilter');
  });

  it('normalizes optional strings and treats blank values as absent', () => {
    assert.strictEqual(normalizeOptionalString('  hello  '), 'hello');
    for (const value of [undefined, null, '', '   \n\t']) {
      assert.strictEqual(normalizeOptionalString(value), undefined);
    }
  });

  it('accepts optional strings exactly at the cap and rejects one beyond it', () => {
    assert.strictEqual(normalizeOptionalString('abcd', { maxLength: 4 }), 'abcd');
    assert.throws(
      () => normalizeOptionalString('abcde', { maxLength: 4 }),
      ValidationError,
    );
  });

  it('rejects non-string optional values with the requested field', () => {
    const error = captureValidationError(() =>
      normalizeOptionalString(123, { field: 'model' }),
    );
    assert.strictEqual(error.field, 'model');
    assert.match(error.message, /model/);
  });
});

describe('boolean, turn, and safe path edge cases', () => {
  it('passes boolean values through and treats numbers by zero-ness', () => {
    assert.strictEqual(normalizeBoolean(true), true);
    assert.strictEqual(normalizeBoolean(false), false);
    assert.strictEqual(normalizeBoolean(0), false);
    assert.strictEqual(normalizeBoolean(-1), true);
    assert.strictEqual(normalizeBoolean(NaN), true);
  });

  it('trims boolean strings and rejects empty whitespace', () => {
    assert.strictEqual(normalizeBoolean('  YES  '), true);
    assert.strictEqual(normalizeBoolean('  off  '), false);
    assert.throws(() => normalizeBoolean('   '), ValidationError);
  });

  it('reports custom boolean fields', () => {
    const error = captureValidationError(() =>
      normalizeBoolean('sometimes', { field: 'enabled' }),
    );
    assert.strictEqual(error.field, 'enabled');
  });

  it('defaults search mode to semantic and accepts both modes case-insensitively', () => {
    assert.strictEqual(normalizeSearchMode(undefined), 'semantic');
    assert.strictEqual(normalizeSearchMode(null), 'semantic');
    assert.strictEqual(normalizeSearchMode(''), 'semantic');
    assert.strictEqual(normalizeSearchMode('semantic'), 'semantic');
    assert.strictEqual(normalizeSearchMode('  KEYWORD  '), 'keyword');
  });

  it('rejects unknown search modes with the mode field', () => {
    const error = captureValidationError(() => normalizeSearchMode('fuzzy'));
    assert.strictEqual(error.field, 'mode');
  });

  it('normalizes all three turn roles without trimming content or model', () => {
    assert.deepStrictEqual(validateTurn({ thinking: ' reason ', model: ' model ' }), {
      role: 'thinking',
      text: ' reason ',
      model: ' model ',
    });
    assert.deepStrictEqual(validateTurn({ ai: 'answer' }), {
      role: 'ai',
      text: 'answer',
      model: undefined,
    });
  });

  it('accepts whitespace-only turn text because it is non-empty', () => {
    assert.deepStrictEqual(validateTurn({ user: ' ' }), {
      role: 'user',
      text: ' ',
      model: undefined,
    });
  });

  it('accepts parseable createdAt values and preserves the original string', () => {
    const turn = validateTurn({
      ai: 'done',
      createdAt: '2026-06-15T10:20:30+02:00',
    });
    assert.strictEqual(turn.createdAt, '2026-06-15T10:20:30+02:00');
  });

  it('rejects invalid createdAt types and strings with the turn index', () => {
    for (const createdAt of ['not-a-date', 123, null]) {
      const error = captureValidationError(() =>
        validateTurn({ user: 'x', createdAt }, { index: 7 }),
      );
      assert.match(error.message, /index 7/);
      assert.match(error.message, /createdAt/);
    }
  });

  it('includes conflicting role names and the index in errors', () => {
    const error = captureValidationError(() =>
      validateTurn({ user: 'u', thinking: 't', ai: 'a' }, { index: 4 }),
    );
    assert.match(error.message, /index 4/);
    assert.match(error.message, /user, thinking, ai/);
  });

  it('requires validateTurns input to be an array and accepts an empty array', () => {
    assert.deepStrictEqual(validateTurns([]), []);
    assert.throws(() => validateTurns({ 0: { user: 'x' } }), ValidationError);
  });

  it('returns the original turns array reference after validation', () => {
    const turns = [{ user: 'one' }, { ai: 'two', createdAt: '2026-01-01' }];
    assert.strictEqual(validateTurns(turns), turns);
  });

  it('accepts path length and segment length boundaries', () => {
    assert.strictEqual(isSafeRelativePath('a'.repeat(255)), true);
    const path = [
      'a'.repeat(255),
      'b'.repeat(255),
      'c'.repeat(255),
      'd'.repeat(255),
    ].join('/');
    assert.strictEqual(path.length, 1023);
    assert.strictEqual(isSafeRelativePath(path), true);
    assert.strictEqual(isSafeRelativePath(`${path}/`), true);
    assert.strictEqual(isSafeRelativePath(`${path}//`), false);
  });

  it('rejects overlong segments even when total path length is valid', () => {
    assert.strictEqual(isSafeRelativePath(`dir/${'x'.repeat(256)}`), false);
  });

  it('rejects traversal and absolute paths with either separator style', () => {
    for (const path of [
      '../secret',
      'a\\..\\secret',
      '\\\\server\\share\\file.json',
      '\\rooted\\file.json',
      'z:/windows/file',
    ]) {
      assert.strictEqual(isSafeRelativePath(path), false, path);
    }
  });

  it('accepts dots inside names, dot segments, unicode, and repeated separators', () => {
    for (const path of ['a..b/file.json', './file.json', 'zażółć/東京.json', 'a//b']) {
      assert.strictEqual(isSafeRelativePath(path), true, path);
    }
  });
});
