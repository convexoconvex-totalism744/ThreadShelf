import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createChangeBatcher, watchFolder } from '../src/watch.js';

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

const waitFor = async (predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(25);
  }
  return predicate();
};

describe('createChangeBatcher', () => {
  it('dedupes paths and flushes one batch after the quiet period', async () => {
    const flushes = [];
    const batcher = createChangeBatcher({
      debounceMs: 30,
      onFlush: async (paths) => {
        flushes.push(paths);
      },
    });

    batcher.add('/a.json');
    batcher.add('/b.json');
    batcher.add('/a.json');
    await wait(80);
    await batcher.settle();

    assert.strictEqual(flushes.length, 1);
    assert.deepStrictEqual([...flushes[0]].sort(), ['/a.json', '/b.json']);
  });

  it('resets the timer while events keep arriving', async () => {
    const flushes = [];
    const batcher = createChangeBatcher({
      debounceMs: 60,
      onFlush: async (paths) => {
        flushes.push(paths);
      },
    });

    batcher.add('/a.json');
    await wait(30);
    batcher.add('/b.json');
    await wait(30);
    assert.strictEqual(flushes.length, 0, 'must not flush while events keep the folder busy');
    await wait(90);
    await batcher.settle();
    assert.strictEqual(flushes.length, 1);
  });

  it('queues changes arriving during a flush into the next batch', async () => {
    const flushes = [];
    let batcherRef;
    const batcher = createChangeBatcher({
      debounceMs: 20,
      onFlush: async (paths) => {
        flushes.push(paths);
        if (flushes.length === 1) batcherRef.add('/late.json');
        await wait(30);
      },
    });
    batcherRef = batcher;

    batcher.add('/first.json');
    await waitFor(() => flushes.length === 2);
    await batcher.settle();

    assert.strictEqual(flushes.length, 2);
    assert.deepStrictEqual(flushes[0], ['/first.json']);
    assert.deepStrictEqual(flushes[1], ['/late.json']);
  });

  it('settle flushes a pending batch immediately', async () => {
    const flushes = [];
    const batcher = createChangeBatcher({
      debounceMs: 60_000,
      onFlush: async (paths) => {
        flushes.push(paths);
      },
    });
    batcher.add('/a.json');
    await batcher.settle();
    assert.strictEqual(flushes.length, 1);
  });
});

describe('watchFolder', () => {
  it('re-ingests changed export files and skips metadata files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadshelf-watch-'));
    const batches = [];
    const watcher = watchFolder('watchtest', root, {
      debounceMs: 50,
      ingest: async (files) => {
        batches.push(files);
        return {
          conversations: 0,
          ingested: 0,
          totalTokens: 0,
          files,
          errors: [],
          providers: {},
          elapsedMs: 0,
        };
      },
    });

    try {
      await mkdir(join(root, 'nested'), { recursive: true });
      await writeFile(join(root, 'export.json'), '{}');
      await writeFile(join(root, 'users.json'), '{}'); // metadata — must be ignored

      await waitFor(() => batches.length >= 1);
      assert.ok(batches.length >= 1, 'expected at least one ingest batch');
      const seen = batches.flat();
      assert.ok(
        seen.some((file) => file.endsWith('export.json')),
        'changed export file must be re-ingested',
      );
      assert.ok(
        !seen.some((file) => file.endsWith('users.json')),
        'metadata files must not be re-ingested',
      );
    } finally {
      await watcher.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores deletions (the archive outlives its source files)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadshelf-watch-del-'));
    await writeFile(join(root, 'export.json'), '{}');

    const batches = [];
    const watcher = watchFolder('watchtest', root, {
      debounceMs: 50,
      ingest: async (files) => {
        batches.push(files);
        return {
          conversations: 0,
          ingested: 0,
          totalTokens: 0,
          files,
          errors: [],
          providers: {},
          elapsedMs: 0,
        };
      },
    });

    try {
      await rm(join(root, 'export.json'));
      await wait(250);
      await watcher.close();
      assert.deepStrictEqual(batches, [], 'a deletion must not trigger an ingest');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
