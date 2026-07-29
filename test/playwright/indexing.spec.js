import { test, expect } from './fixtures.js';

test.describe('Indexing page extras', () => {
  test('export-guide panel shows LM Studio path and the OpenRouter script is served', async ({
    appPage,
  }) => {
    await appPage.locator('#indexingNavBtn').click();

    // The "Where to get your data" guide includes the LM Studio conversation path.
    await appPage.getByText('Where to get your data').click();
    await expect(appPage.getByText(/%USERPROFILE%.*lmstudio.*conversations/)).toBeVisible();

    // The copy buttons pull the real script from the server's /scripts route.
    const status = await appPage.evaluate(async () => {
      const res = await fetch('/scripts/openrouter-export-all.js');
      return { ok: res.ok, body: await res.text() };
    });
    expect(status.ok).toBe(true);
    expect(status.body).toContain("platform: 'openrouter'");
  });

  test('creating a collection from the indexing dropdown selects it as the target', async ({
    appPage,
  }) => {
    await appPage.locator('#indexingNavBtn').click();
    await appPage.locator('#newCollectionBtnIndexing').click();

    await appPage.getByPlaceholder('my-archive').fill('idx_made');
    await appPage.getByRole('button', { name: 'Create' }).click();

    await expect(appPage.locator('#targetCollectionSelect')).toHaveValue('idx_made', {
      timeout: 15_000,
    });
  });
});
