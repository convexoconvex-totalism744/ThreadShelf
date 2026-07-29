import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseInline, parseMarkdown } from '../client/src/markdown.ts';

// Flatten inline nodes back to their plain text for concise assertions.
const inlineText = (nodes) =>
  nodes
    .map((node) => {
      if (node.type === 'text') return node.value;
      if (node.type === 'code') return node.value;
      return inlineText(node.children);
    })
    .join('');

describe('parseInline', () => {
  it('parses bold, italic and inline code', () => {
    const nodes = parseInline('a **bold** and *em* and `code` end');
    const types = nodes.map((n) => n.type);
    assert.ok(types.includes('strong'));
    assert.ok(types.includes('em'));
    assert.ok(types.includes('code'));
    const strong = nodes.find((n) => n.type === 'strong');
    assert.strictEqual(inlineText(strong.children), 'bold');
  });

  it('treats single underscores as literal to protect snake_case', () => {
    const nodes = parseInline('call some_helper_fn now');
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'text');
    assert.strictEqual(nodes[0].value, 'call some_helper_fn now');
  });

  it('supports __double underscore__ bold', () => {
    const nodes = parseInline('__strong__');
    assert.strictEqual(nodes[0].type, 'strong');
    assert.strictEqual(inlineText(nodes[0].children), 'strong');
  });

  it('does not treat inner markers of inline code as markup', () => {
    const nodes = parseInline('`a * b _ c`');
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'code');
    assert.strictEqual(nodes[0].value, 'a * b _ c');
  });

  it('accepts safe link schemes and rejects javascript:', () => {
    const ok = parseInline('[site](https://example.com)');
    assert.strictEqual(ok[0].type, 'link');
    assert.strictEqual(ok[0].href, 'https://example.com');

    const bad = parseInline('[x](javascript:alert(1))');
    assert.ok(bad.every((n) => n.type !== 'link'));
  });

  it('leaves an unterminated marker as literal text', () => {
    const nodes = parseInline('a **b without close');
    assert.strictEqual(inlineText(nodes), 'a **b without close');
  });
});

describe('parseMarkdown', () => {
  it('parses headings with the correct level', () => {
    const [block] = parseMarkdown('### Title');
    assert.strictEqual(block.type, 'heading');
    assert.strictEqual(block.level, 3);
    assert.strictEqual(inlineText(block.children), 'Title');
  });

  it('parses unordered and ordered lists as separate blocks', () => {
    const blocks = parseMarkdown('- one\n- two\n\n1. first\n2. second');
    const lists = blocks.filter((b) => b.type === 'list');
    assert.strictEqual(lists.length, 2);
    assert.strictEqual(lists[0].ordered, false);
    assert.strictEqual(lists[0].items.length, 2);
    assert.strictEqual(lists[1].ordered, true);
    assert.strictEqual(inlineText(lists[1].items[1]), 'second');
  });

  it('captures fenced code verbatim without inline parsing', () => {
    const blocks = parseMarkdown('```js\nconst a = **1**;\n```');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'code');
    assert.strictEqual(blocks[0].lang, 'js');
    assert.strictEqual(blocks[0].value, 'const a = **1**;');
  });

  it('separates paragraphs on blank lines and keeps bold inside', () => {
    const blocks = parseMarkdown('First **para**.\n\nSecond para.');
    const paras = blocks.filter((b) => b.type === 'paragraph');
    assert.strictEqual(paras.length, 2);
    assert.ok(paras[0].children.some((n) => n.type === 'strong'));
  });

  it('parses a blockquote', () => {
    const [block] = parseMarkdown('> quoted line');
    assert.strictEqual(block.type, 'quote');
    assert.strictEqual(inlineText(block.children), 'quoted line');
  });

  it('does not throw and returns no blocks for empty input', () => {
    assert.deepStrictEqual(parseMarkdown(''), []);
    assert.deepStrictEqual(parseMarkdown('   \n\n  '), []);
  });
});
