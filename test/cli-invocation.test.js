import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const runNpmScript = (script, args, env) => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'npm_execpath is required to test the public npm command');
  return spawnSync(process.execPath, [npmCli, 'run', script, '--', ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env, NO_COLOR: '1' },
    encoding: 'utf8',
    timeout: 30_000,
  });
};

describe('documented npm CLI invocations', () => {
  it('forwards flags after the explicit second separator', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'threadshelf-cli-'));
    const env = {
      LANCEDB_PATH: join(tempRoot, '.lancedb'),
      COLLECTIONS_PATH: join(tempRoot, '.collections.json'),
    };

    try {
      const search = runNpmScript(
        'search',
        ['review_probe', '--', '--mode', 'keyword', '--n', '1', '--json'],
        env,
      );
      assert.strictEqual(search.status, 0, `${search.stdout}\n${search.stderr}`);
      assert.match(search.stdout, /"mode": "keyword"/);
      assert.match(search.stdout, /"query": "review_probe"/);

      const parse = runNpmScript(
        'parse',
        [join(repoRoot, 'test', 'fixture.json'), '--', '--no-user', '--no-thinking'],
        env,
      );
      assert.strictEqual(parse.status, 0, `${parse.stdout}\n${parse.stderr}`);
      assert.doesNotMatch(parse.stdout, /Hello, think step by step/);
      assert.match(parse.stdout, /Here is the answer/);

      const missingFolder = join(tempRoot, 'definitely-missing');
      const ingest = runNpmScript(
        'ingest',
        [missingFolder, 'review_watch', '--', '--watch', '--debounce', '10'],
        env,
      );
      assert.strictEqual(ingest.status, 1, `${ingest.stdout}\n${ingest.stderr}`);
      assert.match(ingest.stderr, /\[ingest\] failed:/);
      assert.match(`${ingest.stdout}\n${ingest.stderr}`, /--watch --debounce 10/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
