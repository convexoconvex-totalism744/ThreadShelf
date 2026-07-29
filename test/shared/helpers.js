import { copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, '..', '..');
const fixturesDir = join(repoRoot, 'test', 'fixtures');

export const waitForHealth = async (baseUrl, timeoutMs = 120_000) => {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Server did not become healthy: ${lastError?.message || 'timeout'}`);
};

export const stopChildProcess = async (child) => {
  const closed = new Promise((resolve) => child.once('close', resolve));
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await closed;
};

export const ingestViaNdjson = async (baseUrl, folderPath, collection, clearFirst = true) => {
  const res = await fetch(new URL('/api/ingest-progress', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folderPath, collection, clearFirst }),
  });
  if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);

  const text = await res.text();
  const events = text
    .split('\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => JSON.parse(block));
  const completed = events.find((event) => event.status === 'completed');
  if (!completed) throw new Error(`No completed event in: ${text}`);
  return completed.result;
};

export const createMixedFixtureFolder = async (root) => {
  const exportsDir = join(root, 'exports');
  const providers = [
    ['gemini', 'gemini-polish.json'],
    ['claude', 'anthropic-polish.json'],
    ['chatgpt', 'openai-polish.json'],
    ['openrouter', 'openrouter-polish.json'],
    ['lmstudio', 'lmstudio-polish.json'],
    ['grok', 'grok-polish.json'],
  ];

  for (const [folder, fixture] of providers) {
    await mkdir(join(exportsDir, folder), { recursive: true });
    await copyFile(join(fixturesDir, fixture), join(exportsDir, folder, 'conversation.json'));
  }

  return exportsDir;
};
