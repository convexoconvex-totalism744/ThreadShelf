import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ingestFiles, listExportFiles } from '../src/ingest.js';
import { createMixedFixtureFolder } from './shared/helpers.js';

describe('listExportFiles', () => {
  it('honors an aborted indexing signal before starting work', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Indexing stopped', 'AbortError'));

    await assert.rejects(
      () => ingestFiles('cancelled_fixture', [], { signal: controller.signal }),
      (error) => error instanceof Error && error.name === 'AbortError',
    );
  });

  it('finds exports recursively and skips metadata files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadshelf-ingest-'));
    try {
      await mkdir(join(root, 'nested', 'deeper'), { recursive: true });
      await writeFile(join(root, 'users.json'), '{}');
      await writeFile(join(root, 'nested', 'projects.json'), '{}');
      await writeFile(join(root, 'nested', 'deeper', 'message_feedback.json'), '{}');
      await writeFile(join(root, 'nested', 'applet_access_history.json'), '{}');
      await writeFile(join(root, 'root-export.json'), '{}');
      await writeFile(join(root, 'nested', 'conversation.json'), '{}');
      await writeFile(join(root, 'nested', 'deeper', 'no-extension-export'), '{}');

      const files = await listExportFiles(root);
      const normalized = files.map((file) => file.replace(/\\/g, '/')).sort();

      assert.strictEqual(normalized.length, 3);
      assert.ok(normalized.some((file) => file.endsWith('/root-export.json')));
      assert.ok(normalized.some((file) => file.endsWith('/nested/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/nested/deeper/no-extension-export')));
      assert.ok(!normalized.some((file) => file.endsWith('/users.json')));
      assert.ok(!normalized.some((file) => file.endsWith('/projects.json')));
      assert.ok(!normalized.some((file) => file.endsWith('/message_feedback.json')));
      assert.ok(!normalized.some((file) => file.endsWith('/applet_access_history.json')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not collapse same filenames from different folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadshelf-ingest-'));
    try {
      await mkdir(join(root, 'a'), { recursive: true });
      await mkdir(join(root, 'b'), { recursive: true });
      await writeFile(join(root, 'a', 'conversation.json'), '{}');
      await writeFile(join(root, 'b', 'conversation.json'), '{}');

      const files = await listExportFiles(root);
      const normalized = files.map((file) => file.replace(/\\/g, '/')).sort();

      assert.strictEqual(normalized.length, 2);
      assert.ok(normalized.some((file) => file.endsWith('/a/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/b/conversation.json')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers anonymized fixtures for every supported provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadshelf-mixed-fixtures-'));
    try {
      const exportsDir = await createMixedFixtureFolder(root);
      const files = await listExportFiles(exportsDir);
      const normalized = files.map((file) => file.replace(/\\/g, '/')).sort();

      assert.strictEqual(normalized.length, 6);
      assert.ok(normalized.some((file) => file.endsWith('/gemini/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/claude/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/chatgpt/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/openrouter/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/lmstudio/conversation.json')));
      assert.ok(normalized.some((file) => file.endsWith('/grok/conversation.json')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
