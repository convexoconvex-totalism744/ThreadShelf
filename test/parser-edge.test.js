/**
 * Edge-case tests for the parsers. The goal here is to *find bugs*: feed in
 * malformed, hostile, and unusual inputs and document what the parsers
 * actually do. Each test below corresponds to a real failure mode reported by
 * users or one that the parser must guard against.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseExport,
  parseGoogleAIStudio,
  parseAnthropic,
  parseOpenAI,
  parseOpenRouter,
} from '../src/parser.js';

describe('parseExport — format detection edge cases', () => {
  it('rejects primitives and null', () => {
    assert.strictEqual(parseExport(null).error, 'Unknown export format (expected Google AI Studio, Anthropic, OpenAI, OpenRouter, LM Studio, or Grok)');
    assert.strictEqual(parseExport(123).error, 'Unknown export format (expected Google AI Studio, Anthropic, OpenAI, OpenRouter, LM Studio, or Grok)');
    assert.strictEqual(parseExport('"hello"').error, 'Unknown export format (expected Google AI Studio, Anthropic, OpenAI, OpenRouter, LM Studio, or Grok)');
  });

  it('rejects empty arrays without crashing', () => {
    const result = parseExport([]);
    assert.strictEqual(result.error, 'Unknown export format (expected Google AI Studio, Anthropic, OpenAI, OpenRouter, LM Studio, or Grok)');
  });

  it('returns a JSON syntax error for malformed JSON', () => {
    const result = parseExport('{not: "json"}');
    assert.match(result.error, /Invalid JSON/);
  });

  it('detects single-object Anthropic, single-object OpenAI, OpenRouter, Gemini', () => {
    assert.strictEqual(parseExport({ chat_messages: [{ sender: 'human', text: 'hi' }] }).turns.length, 1);
    assert.strictEqual(parseExport({ mapping: {}, current_node: null }).turns.length, 0);
    assert.strictEqual(parseExport({ platform: 'openrouter', turns: [] }).turns.length, 0);
    assert.strictEqual(parseExport({ chunkedPrompt: { chunks: [] } }).turns.length, 0);
  });
});

describe('parseGoogleAIStudio — hostile inputs', () => {
  it('ignores chunks with non-string text fields', () => {
    const result = parseGoogleAIStudio({
      chunkedPrompt: { chunks: [{ role: 'user', text: 42 }, { role: 'model', text: ['a', 'b'] }] },
    });
    assert.deepStrictEqual(result.turns, []);
  });

  it('ignores unknown roles silently', () => {
    const result = parseGoogleAIStudio({
      chunkedPrompt: {
        chunks: [
          { role: 'system', text: 'system message' },
          { role: 'tool', text: 'tool result' },
          { role: 'user', text: 'real' },
        ],
      },
    });
    assert.deepStrictEqual(result.turns, [{ user: 'real' }]);
  });

  it('omits driveImage placeholder when includeUser=false', () => {
    const result = parseGoogleAIStudio({
      chunkedPrompt: { chunks: [{ role: 'user', driveImage: { id: 'x' } }] },
    }, { includeUser: false });
    assert.deepStrictEqual(result.turns, []);
  });

  it('omits model field when runSettings.model is not a string', () => {
    const result = parseGoogleAIStudio({
      runSettings: { model: 42 },
      chunkedPrompt: { chunks: [{ role: 'model', text: 'A' }] },
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'A' }]);
  });

  it('survives null entries in chunks array', () => {
    const result = parseGoogleAIStudio({
      chunkedPrompt: { chunks: [null, { role: 'user', text: 'ok' }, undefined] },
    });
    assert.deepStrictEqual(result.turns, [{ user: 'ok' }]);
  });
});

describe('parseAnthropic — edge cases', () => {
  it('handles a single conversation object (not array)', () => {
    const result = parseAnthropic({ chat_messages: [{ sender: 'human', text: 'Hi' }] });
    assert.deepStrictEqual(result.turns, [{ user: 'Hi' }]);
  });

  it('skips conversations whose chat_messages is missing or wrong type', () => {
    const result = parseAnthropic([
      { chat_messages: null },
      { chat_messages: 'not an array' },
      { chat_messages: [{ sender: 'human', text: 'survives' }] },
    ]);
    assert.deepStrictEqual(result.turns, [{ user: 'survives' }]);
  });

  it('uses conversation.model as fallback when message has no model', () => {
    const result = parseAnthropic({
      model: 'claude-opus-4-7',
      chat_messages: [{ sender: 'assistant', text: 'Hello' }],
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'Hello', model: 'claude-opus-4-7' }]);
  });

  it('prefers msg.model over conv.model', () => {
    const result = parseAnthropic({
      model: 'conv-default',
      chat_messages: [{ sender: 'assistant', text: 'Hello', model: 'msg-specific' }],
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'Hello', model: 'msg-specific' }]);
  });

  it('skips messages with non-string text', () => {
    const result = parseAnthropic({
      chat_messages: [
        { sender: 'human', text: ['arr'] },
        { sender: 'human', text: null },
        { sender: 'human', text: 'real' },
      ],
    });
    assert.deepStrictEqual(result.turns, [{ user: 'real' }]);
  });

  it('drops messages with unknown sender silently', () => {
    const result = parseAnthropic({
      chat_messages: [
        { sender: 'system', text: 'sys' },
        { sender: 'tool', text: 'tool' },
        { sender: 'human', text: 'Q' },
      ],
    });
    assert.deepStrictEqual(result.turns, [{ user: 'Q' }]);
  });

  it('extracts conversations from a {conversations:[...]} wrapper', () => {
    const result = parseAnthropic({
      conversations: [{ chat_messages: [{ sender: 'human', text: 'wrapped' }] }],
    });
    assert.deepStrictEqual(result.turns, [{ user: 'wrapped' }]);
  });

  it('ignores compact numeric date strings instead of reading them as epochs', () => {
    // "20240101120000" is Number()-finite; read as epoch ms it lands in 2611.
    const result = parseAnthropic({
      chat_messages: [{ sender: 'human', text: 'hi', created_at: '20240101120000' }],
    });
    assert.deepStrictEqual(result.turns, [{ user: 'hi' }]);
  });

  it('still accepts plausible epoch-second strings', () => {
    const result = parseAnthropic({
      chat_messages: [{ sender: 'human', text: 'hi', created_at: '1704067200' }],
    });
    assert.deepStrictEqual(result.turns, [{ user: 'hi', createdAt: '2024-01-01T00:00:00.000Z' }]);
  });
});

describe('parseOpenAI — edge cases', () => {
  it('breaks out of a parent cycle without infinite loop', () => {
    const result = parseOpenAI({
      current_node: 'a',
      mapping: {
        a: { id: 'a', parent: 'b', children: [], message: { author: { role: 'user' }, content: { parts: ['A'] } } },
        b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { parts: ['B'] } } },
      },
    });
    // Reads from current_node walking up, breaks on cycle.
    assert.ok(result.turns.length >= 1);
    assert.strictEqual(result.error, undefined);
  });

  it('falls back to time-sorted nodes when current_node missing', () => {
    const result = parseOpenAI({
      mapping: {
        a: { id: 'a', parent: null, children: [], message: { author: { role: 'user' }, content: { parts: ['first'] }, create_time: 1 } },
        b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { parts: ['second'] }, create_time: 2 } },
      },
    });
    assert.deepStrictEqual(result.turns, [{ user: 'first' }, { ai: 'second' }]);
  });

  it('skips system/tool roles even on the active branch', () => {
    const result = parseOpenAI({
      current_node: 't',
      mapping: {
        root: { id: 'root', parent: null, children: ['s'], message: { author: { role: 'system' }, content: { parts: ['sys'] } } },
        s: { id: 's', parent: 'root', children: ['t'], message: { author: { role: 'tool' }, content: { parts: ['tool'] } } },
        t: { id: 't', parent: 's', children: [], message: { author: { role: 'assistant' }, content: { parts: ['ans'] } } },
      },
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'ans' }]);
  });

  it('returns empty when mapping is not an object', () => {
    assert.deepStrictEqual(parseOpenAI({ mapping: null, current_node: 'x' }).turns, []);
  });

  it('extracts text from deeply nested parts', () => {
    const result = parseOpenAI({
      current_node: 'a',
      mapping: {
        a: {
          id: 'a',
          parent: null,
          children: [],
          message: { author: { role: 'user' }, content: [{ parts: [{ text: 'deep' }] }, 'plain'] },
        },
      },
    });
    // The recursive extractor joins with \n\n.
    assert.strictEqual(result.turns[0]?.user.includes('deep'), true);
    assert.strictEqual(result.turns[0]?.user.includes('plain'), true);
  });

  it('uses default_model_slug when message has no model_slug', () => {
    const result = parseOpenAI({
      default_model_slug: 'gpt-default',
      current_node: 'a',
      mapping: {
        a: { id: 'a', parent: null, children: [], message: { author: { role: 'assistant' }, content: { parts: ['hi'] } } },
      },
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'hi', model: 'gpt-default' }]);
  });
});

describe('parseOpenRouter — edge cases', () => {
  it('skips entries with no role or no text', () => {
    const result = parseOpenRouter({
      platform: 'openrouter',
      turns: [
        { content: 'orphan no role' },
        { role: 'user', content: '' },
        { role: 'user' },
        { role: 'assistant', content: 'kept' },
      ],
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'kept' }]);
  });

  it('treats array-of-strings content as joined paragraphs', () => {
    const result = parseOpenRouter({
      platform: 'openrouter',
      turns: [{ role: 'user', content: ['line one', 'line two'] }],
    });
    assert.strictEqual(result.turns[0].user, 'line one\n\nline two');
  });

  it('returns empty turns when input is not an object', () => {
    assert.deepStrictEqual(parseOpenRouter('null').turns, []);
    assert.deepStrictEqual(parseOpenRouter('[]').turns, []);
  });

  it('rejects blank model strings (does not attach empty model)', () => {
    const result = parseOpenRouter({
      platform: 'openrouter',
      turns: [{ role: 'assistant', content: 'A', model: '   ' }],
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'A' }]);
  });
});
