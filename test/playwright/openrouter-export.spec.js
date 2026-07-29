import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { test, expect } from './fixtures.js';
import { ingestViaNdjson } from '../e2e/helpers.js';

// Runs the REAL export script against an anonymized snapshot of OpenRouter's DOM,
// then feeds the extracted JSON through the real ingest + search pipeline. This is
// the regression contract for the console exporters in scripts/openrouter-export-*.js.
test.describe('OpenRouter export script', () => {
  const fixtureUrl = pathToFileURL(resolve('test/fixtures/openrouter-page.html')).href;

  test('finds sidebar chats and extracts turns (reasoning excluded)', async ({ page }) => {
    await page.addInitScript(() => {
      window.__OR_TEST__ = true;
    });
    await page.goto(fixtureUrl);
    await page.addScriptTag({ path: resolve('scripts/openrouter-export-all.js') });

    const chats = await page.evaluate(() => window.__ORX.findChats());
    expect(chats.map((c) => c.id)).toEqual(['orc-111-AaAa', 'orc-222-BbBb']); // /chat (new) skipped
    expect(chats[0].title).toBe('Wiersz o kodzie');

    const payload = await page.evaluate(() =>
      window.__ORX.buildPayload(window.__ORX.extractTurns(), 'Test chat'),
    );
    expect(payload.platform).toBe('openrouter');
    expect(payload.turns).toHaveLength(2);

    const [userTurn, assistantTurn] = payload.turns;
    expect(userTurn.role).toBe('user');
    expect(userTurn.content).toContain('zażółć gęślą jaźń');
    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.model).toBe('test-model');
    expect(assistantTurn.content).toContain('日本語');
    expect(assistantTurn.content).not.toMatch(/REASONING/i); // reasoning panel dropped
  });

  test('the single-chat script extracts the same turns', async ({ page }) => {
    await page.addInitScript(() => {
      window.__OR_TEST__ = true;
    });
    await page.goto(fixtureUrl);
    await page.addScriptTag({ path: resolve('scripts/openrouter-export-browser.js') });
    const turns = await page.evaluate(() => window.__ORX.extractTurns());
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  test('extracted JSON parses through the real ingest + search pipeline', async ({
    page,
    serverContext,
  }) => {
    await page.addInitScript(() => {
      window.__OR_TEST__ = true;
    });
    await page.goto(fixtureUrl);
    await page.addScriptTag({ path: resolve('scripts/openrouter-export-all.js') });
    const payload = await page.evaluate(() =>
      window.__ORX.buildPayload(window.__ORX.extractTurns(), 'OpenRouter export test'),
    );

    const dir = await mkdtemp(join(tmpdir(), 'or-export-'));
    try {
      await writeFile(join(dir, 'chat.json'), JSON.stringify(payload), 'utf-8');

      const ingest = await ingestViaNdjson(serverContext.baseUrl, dir, 'or_export_test');
      expect(ingest.files.length).toBe(1);
      expect(ingest.errors.length).toBe(0);
      expect(ingest.providers['openrouter']).toBe(1);

      const url = new URL('/api/search', serverContext.baseUrl);
      url.searchParams.set('collection', 'or_export_test');
      url.searchParams.set('q', '日本語 final answer');
      const res = await fetch(url);
      const data = await res.json();
      expect(data.results.length).toBeGreaterThan(0);
      expect(JSON.stringify(data.results)).toMatch(/日本語|zażółć/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
