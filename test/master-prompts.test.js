import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMasterPrompt,
  deleteMasterPrompt,
  listMasterPrompts,
  masterPromptsPath,
  setActiveMasterPrompt,
  updateMasterPrompt,
} from '../src/generation/master-prompts.js';
import { ValidationError } from '../src/validation.js';

const roots = [];
const useTempStore = async () => {
  const root = await mkdtemp(join(tmpdir(), 'threadshelf-master-prompts-'));
  roots.push(root);
  process.env.MASTER_PROMPTS_PATH = join(root, 'master-prompts.json');
  return root;
};

describe('master prompts', () => {
  afterEach(async () => {
    delete process.env.MASTER_PROMPTS_PATH;
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('starts empty and stores a created prompt on disk as the active one', async () => {
    await useTempStore();
    assert.deepStrictEqual(await listMasterPrompts(), { prompts: [], activeId: '' });

    const created = await createMasterPrompt({ name: 'Terse', text: '  Answer briefly.  ' });
    assert.strictEqual(created.prompts.length, 1);
    assert.strictEqual(created.prompts[0].name, 'Terse');
    assert.strictEqual(created.prompts[0].text, 'Answer briefly.');
    assert.strictEqual(created.activeId, created.prompts[0].id);
    assert.match(created.prompts[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    // Survives a fresh read — the point of moving this off browser storage.
    const stored = JSON.parse(await readFile(masterPromptsPath(), 'utf8'));
    assert.strictEqual(stored.prompts[0].text, 'Answer briefly.');
    assert.deepStrictEqual(await listMasterPrompts(), created);
  });

  it('names an unnamed prompt after its opening words', async () => {
    await useTempStore();
    const created = await createMasterPrompt({
      text: 'You  are   a meticulous reviewer who never guesses at intent.',
    });
    assert.strictEqual(created.prompts[0].name, 'You are a meticulous reviewe');
  });

  it('rejects an empty prompt and an over-long name', async () => {
    await useTempStore();
    await assert.rejects(() => createMasterPrompt({ text: '   ' }), ValidationError);
    await assert.rejects(() => createMasterPrompt({ text: 42 }), ValidationError);
    await assert.rejects(
      () => createMasterPrompt({ name: 'x'.repeat(61), text: 'valid' }),
      ValidationError,
    );
    assert.deepStrictEqual(await listMasterPrompts(), { prompts: [], activeId: '' });
  });

  it('updates, switches, turns off, and deletes without losing the rest', async () => {
    await useTempStore();
    // Prompts append in creation order; the newest is always the active one.
    const first = (await createMasterPrompt({ name: 'One', text: 'First prompt' })).prompts.at(-1);
    const second = (await createMasterPrompt({ name: 'Two', text: 'Second prompt' })).prompts.at(
      -1,
    );

    let collection = await listMasterPrompts();
    assert.strictEqual(collection.activeId, second.id, 'a new prompt becomes the active one');

    collection = await updateMasterPrompt(first.id, { text: 'First prompt, revised' });
    assert.strictEqual(collection.prompts[0].text, 'First prompt, revised');
    assert.strictEqual(collection.activeId, first.id, 'editing a prompt activates it');
    assert.strictEqual(collection.prompts[1].text, 'Second prompt');

    collection = await setActiveMasterPrompt('');
    assert.strictEqual(collection.activeId, '');
    assert.strictEqual(collection.prompts.length, 2, 'off keeps both prompts');

    await assert.rejects(() => setActiveMasterPrompt('missing-id'), ValidationError);
    await assert.rejects(() => updateMasterPrompt('missing-id', { text: 'x' }), ValidationError);
    await assert.rejects(() => deleteMasterPrompt('missing-id'), ValidationError);

    collection = await setActiveMasterPrompt(second.id);
    collection = await deleteMasterPrompt(second.id);
    assert.deepStrictEqual(
      collection.prompts.map((prompt) => prompt.id),
      [first.id],
    );
    assert.strictEqual(collection.activeId, '', 'deleting the active prompt turns it off');
  });

  it('serializes concurrent writes instead of dropping them', async () => {
    await useTempStore();
    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        createMasterPrompt({ name: `P${index}`, text: `Prompt ${index}` }),
      ),
    );
    const collection = await listMasterPrompts();
    assert.strictEqual(collection.prompts.length, 8);
    assert.strictEqual(new Set(collection.prompts.map((prompt) => prompt.id)).size, 8);
  });

  it('drops malformed entries and a dangling active id rather than failing', async () => {
    const root = await useTempStore();
    await writeFile(
      join(root, 'master-prompts.json'),
      JSON.stringify({
        prompts: [{ id: 'a', name: 'Kept', text: 'Fine' }, null, { id: 'b', name: 'No text' }],
        activeId: 'deleted-elsewhere',
      }),
    );
    assert.deepStrictEqual(await listMasterPrompts(), {
      prompts: [{ id: 'a', name: 'Kept', text: 'Fine', updatedAt: '' }],
      activeId: '',
    });
  });
});
