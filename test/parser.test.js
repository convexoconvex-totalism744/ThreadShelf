import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseGoogleAIStudio, parseAnthropic, parseOpenAI, parseOpenRouter, parseExport, parseFile } from '../src/parser.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('parseGoogleAIStudio', () => {
  it('returns error and empty turns for invalid JSON', () => {
    const result = parseGoogleAIStudio('not json');
    assert.strictEqual(result.error?.startsWith('Invalid JSON'), true);
    assert.deepStrictEqual(result.turns, []);
  });

  it('returns error when chunkedPrompt.chunks is missing', () => {
    const result = parseGoogleAIStudio('{}');
    assert.strictEqual(result.error, 'Missing or invalid chunkedPrompt.chunks');
    assert.deepStrictEqual(result.turns, []);
  });

  it('returns error when chunks is not an array', () => {
    const result = parseGoogleAIStudio(JSON.stringify({ chunkedPrompt: { chunks: null } }));
    assert.strictEqual(result.error, 'Missing or invalid chunkedPrompt.chunks');
    assert.deepStrictEqual(result.turns, []);
  });

  it('returns empty turns for empty chunks', () => {
    const result = parseGoogleAIStudio(JSON.stringify({ chunkedPrompt: { chunks: [] } }));
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, []);
  });

  it('extracts single user message', () => {
    const input = {
      chunkedPrompt: {
        chunks: [{ role: 'user', text: ' Hello world ' }],
      },
    };
    const result = parseGoogleAIStudio(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [{ user: 'Hello world' }]);
  });

  it('extracts user + thinking + ai in order', () => {
    const input = {
      runSettings: {
        model: 'models/gemini-3-pro-preview',
      },
      chunkedPrompt: {
        chunks: [
          { role: 'user', text: 'Hi' },
          { role: 'model', isThought: true, text: ' Thinking... ' },
          { role: 'model', text: ' Answer. ' },
        ],
      },
    };
    const result = parseGoogleAIStudio(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [
      { user: 'Hi' },
      { thinking: 'Thinking...', model: 'models/gemini-3-pro-preview' },
      { ai: 'Answer.', model: 'models/gemini-3-pro-preview' },
    ]);
  });

  it('omits empty user text', () => {
    const input = {
      chunkedPrompt: {
        chunks: [{ role: 'user', text: '   ' }],
      },
    };
    const result = parseGoogleAIStudio(input);
    assert.deepStrictEqual(result.turns, []);
  });

  it('includes user turn for driveImage-only chunk', () => {
    const input = {
      chunkedPrompt: {
        chunks: [{ role: 'user', driveImage: { id: 'xyz' } }],
      },
    };
    const result = parseGoogleAIStudio(input);
    assert.deepStrictEqual(result.turns, [{ user: '[image]' }]);
  });

  it('respects includeUser: false', () => {
    const input = {
      chunkedPrompt: {
        chunks: [
          { role: 'user', text: 'Hi' },
          { role: 'model', text: 'Bye' },
        ],
      },
    };
    const result = parseGoogleAIStudio(input, { includeUser: false });
    assert.deepStrictEqual(result.turns, [{ ai: 'Bye' }]);
  });

  it('respects includeThinking: false', () => {
    const input = {
      chunkedPrompt: {
        chunks: [
          { role: 'user', text: 'Hi' },
          { role: 'model', isThought: true, text: 'Think' },
          { role: 'model', text: 'Answer' },
        ],
      },
    };
    const result = parseGoogleAIStudio(input, { includeThinking: false });
    assert.deepStrictEqual(result.turns, [{ user: 'Hi' }, { ai: 'Answer' }]);
  });

  it('respects includeAi: false', () => {
    const input = {
      chunkedPrompt: {
        chunks: [
          { role: 'user', text: 'Hi' },
          { role: 'model', isThought: true, text: 'Think' },
          { role: 'model', text: 'Answer' },
        ],
      },
    };
    const result = parseGoogleAIStudio(input, { includeAi: false });
    assert.deepStrictEqual(result.turns, [{ user: 'Hi' }, { thinking: 'Think' }]);
  });

  it('accepts pre-parsed object input', () => {
    const input = { chunkedPrompt: { chunks: [{ role: 'user', text: 'Ok' }] } };
    const result = parseGoogleAIStudio(input);
    assert.deepStrictEqual(result.turns, [{ user: 'Ok' }]);
  });

  it('parses fixture file structure correctly', async () => {
    const path = join(__dirname, 'fixture.json');
    const raw = await readFile(path, 'utf-8');
    const result = parseGoogleAIStudio(raw);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.turns.length, 3);
    assert.strictEqual(result.turns[0].user, 'Hello, think step by step.');
    assert.strictEqual(result.turns[1].thinking, 'I will think first.\n\nThen answer.');
    assert.strictEqual(result.turns[2].ai, 'Here is the answer.');
  });
});

describe('parseAnthropic', () => {
  it('parses array of conversations with chat_messages', () => {
    const input = [
      { chat_messages: [{ sender: 'human', text: 'Hi' }, { sender: 'assistant', text: 'Hello', model: 'claude-sonnet-4-5' }] },
    ];
    const result = parseAnthropic(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [{ user: 'Hi' }, { ai: 'Hello', model: 'claude-sonnet-4-5' }]);
  });

  it('skips empty text and respects includeUser/includeAi', () => {
    const input = [{ chat_messages: [{ sender: 'human', text: '  ' }, { sender: 'assistant', text: 'Ok' }] }];
    const result = parseAnthropic(input, { includeUser: false });
    assert.deepStrictEqual(result.turns, [{ ai: 'Ok' }]);
  });
});

describe('parseOpenAI', () => {
  it('parses active branch of ChatGPT conversations export', () => {
    const input = [
      {
        current_node: 'assistant-final',
        mapping: {
          root: { id: 'root', parent: null, children: ['system'] },
          system: {
            id: 'system',
            parent: 'root',
            children: ['user-1'],
            message: {
              author: { role: 'system' },
              content: { content_type: 'text', parts: [''] },
              create_time: 1,
            },
          },
          'user-1': {
            id: 'user-1',
            parent: 'system',
            children: ['assistant-final'],
            message: {
              author: { role: 'user' },
              content: { content_type: 'text', parts: ['Hello from OpenAI export'] },
              create_time: 2,
            },
          },
            'assistant-final': {
              id: 'assistant-final',
              parent: 'user-1',
              children: [],
              message: {
                author: { role: 'assistant' },
                content: { content_type: 'text', parts: ['Assistant reply'] },
                metadata: { model_slug: 'gpt-4' },
                create_time: 3,
              },
            },
          },
      },
    ];

    const result = parseOpenAI(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [
      { user: 'Hello from OpenAI export' },
      { ai: 'Assistant reply', model: 'gpt-4' },
    ]);
  });

  it('supports content parts objects and includeAi filtering', () => {
    const input = {
      current_node: 'assistant-final',
      mapping: {
        root: { id: 'root', parent: null, children: ['user-1'] },
        'user-1': {
          id: 'user-1',
          parent: 'root',
          children: ['assistant-final'],
          message: {
            author: { role: 'user' },
            content: { content_type: 'text', parts: [{ text: 'Multipart user text' }] },
            create_time: 1,
          },
        },
        'assistant-final': {
          id: 'assistant-final',
          parent: 'user-1',
          children: [],
          message: {
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: [{ text: 'Multipart assistant text' }] },
            create_time: 2,
          },
        },
      },
    };

    const result = parseOpenAI(input, { includeAi: false });
    assert.deepStrictEqual(result.turns, [{ user: 'Multipart user text' }]);
  });
});

describe('parseOpenRouter', () => {
  it('parses browser script export format', () => {
    const input = {
      platform: 'openrouter',
      exportedAt: '2026-05-05T00:00:00.000Z',
      turns: [
        { role: 'user', content: 'Question from OpenRouter' },
        { role: 'assistant', content: 'Answer from OpenRouter', model: 'openai/gpt-5.1' },
      ],
    };

    const result = parseOpenRouter(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [
      { user: 'Question from OpenRouter' },
      { ai: 'Answer from OpenRouter', model: 'openai/gpt-5.1' },
    ]);
  });

  it('respects includeUser/includeAi filters', () => {
    const input = {
      platform: 'openrouter',
      turns: [
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' },
      ],
    };

    assert.deepStrictEqual(parseOpenRouter(input, { includeUser: false }).turns, [{ ai: 'Answer' }]);
    assert.deepStrictEqual(parseOpenRouter(input, { includeAi: false }).turns, [{ user: 'Question' }]);
  });

  it('supports text fallback, content arrays, and mixed assistant role aliases', () => {
    const input = {
      platform: 'openrouter',
      turns: [
        { role: 'user', text: 'Question from older script shape' },
        { role: 'model', content: [{ text: 'Model alias answer' }], model: 'google/gemini-3-pro' },
        { role: 'ai', content: ['AI alias', { content: 'answer part' }] },
      ],
    };

    const result = parseOpenRouter(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [
      { user: 'Question from older script shape' },
      { ai: 'Model alias answer', model: 'google/gemini-3-pro' },
      { ai: 'AI alias\n\nanswer part' },
    ]);
  });
});

describe('parseExport', () => {
  it('detects Google AI Studio format', () => {
    const input = { chunkedPrompt: { chunks: [{ role: 'user', text: 'Hi' }] } };
    const result = parseExport(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [{ user: 'Hi' }]);
  });

  it('detects Anthropic format', () => {
    const input = [{ chat_messages: [{ sender: 'human', text: 'Q' }, { sender: 'assistant', text: 'A' }] }];
    const result = parseExport(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [{ user: 'Q' }, { ai: 'A' }]);
  });

  it('detects OpenAI format', () => {
    const input = [{
      current_node: 'a',
      mapping: {
        root: { id: 'root', parent: null, children: ['u'] },
        u: {
          id: 'u',
          parent: 'root',
          children: ['a'],
          message: { author: { role: 'user' }, content: { parts: ['Q'] }, create_time: 1 },
        },
        a: {
          id: 'a',
          parent: 'u',
          children: [],
          message: { author: { role: 'assistant' }, content: { parts: ['A'] }, create_time: 2 },
        },
      },
    }];
    const result = parseExport(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [{ user: 'Q' }, { ai: 'A' }]);
  });

  it('detects OpenRouter format', () => {
    const input = {
      platform: 'openrouter',
      turns: [
        { role: 'user', content: 'Q' },
        { role: 'assistant', content: 'A', model: 'anthropic/claude-sonnet-4.5' },
      ],
    };
    const result = parseExport(input);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.turns, [{ user: 'Q' }, { ai: 'A', model: 'anthropic/claude-sonnet-4.5' }]);
  });
});

describe('parseFile', () => {
  it('reads and parses fixture', async () => {
    const path = join(__dirname, 'fixture.json');
    const result = await parseFile(path);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.turns.length, 3);
    assert.strictEqual(result.turns[0].user, 'Hello, think step by step.');
  });

  it('respects options', async () => {
    const path = join(__dirname, 'fixture.json');
    const result = await parseFile(path, { includeAi: false });
    assert.strictEqual(result.turns.length, 2);
    assert.ok(result.turns[0].user);
    assert.ok(result.turns[1].thinking);
    assert.ok(!result.turns.some((t) => t.ai));
  });
});
