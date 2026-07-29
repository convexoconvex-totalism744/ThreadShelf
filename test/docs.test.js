import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const markdownFiles = async () => {
  const docs = (await readdir(join(repoRoot, 'docs')))
    .filter((file) => file.endsWith('.md'))
    .map((file) => join('docs', file));
  return ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', ...docs];
};

describe('public documentation', () => {
  it('keeps every relative Markdown link pointed at an existing file', async () => {
    const missing = [];

    for (const file of await markdownFiles()) {
      const absoluteFile = join(repoRoot, file);
      const content = await readFile(absoluteFile, 'utf8');
      const links = content.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g);

      for (const match of links) {
        const rawTarget = match[1].trim().replace(/^<|>$/g, '');
        if (!rawTarget || rawTarget.startsWith('#') || /^[a-z][a-z+.-]*:/i.test(rawTarget)) {
          continue;
        }

        const relativeTarget = decodeURIComponent(rawTarget.split('#')[0].split('?')[0]);
        const absoluteTarget = resolve(dirname(absoluteFile), relativeTarget);
        try {
          await stat(absoluteTarget);
        } catch {
          missing.push(`${file} -> ${rawTarget}`);
        }
      }
    }

    assert.deepStrictEqual(missing, []);
  });
});
