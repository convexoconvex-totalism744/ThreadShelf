import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectProvider,
  parseExport,
  parseConversationGroups,
  listConversationsFromExport,
  getConversationFromExport,
  parseGoogleAIStudio,
  parseAnthropic,
  parseOpenAI,
  parseOpenRouter,
} from '../src/parser.js';

describe('parser malformed input and provider detection', () => {
  it('reports truncated JSON without throwing', () => {
    for (const input of ['{', '[{"mapping":', '{"platform":"openrouter","turns":[']) {
      const result = parseExport(input);
      assert.deepStrictEqual(result.turns, []);
      assert.match(result.error, /^Invalid JSON:/);
    }
  });

  it('detects only structurally valid provider markers', () => {
    assert.strictEqual(detectProvider({ chunkedPrompt: { chunks: [] } }), 'google-ai-studio');
    assert.strictEqual(detectProvider({ imagenPrompt: { imagenTurns: [] } }), 'google-ai-studio');
    assert.strictEqual(detectProvider({ chat_messages: [] }), 'anthropic');
    assert.strictEqual(detectProvider({ conversations: [{ chat_messages: [] }] }), 'anthropic');
    assert.strictEqual(
      detectProvider({
        project: {},
        messages: [{ role: 'user', content: { content: 'project question' } }],
      }),
      'anthropic',
    );
    assert.strictEqual(detectProvider({ mapping: {} }), 'openai');
    assert.strictEqual(detectProvider({ platform: 'openrouter', turns: [] }), 'openrouter');
    assert.strictEqual(detectProvider({ platform: 'openrouter', turns: {} }), 'unknown');
    assert.strictEqual(detectProvider({ chunkedPrompt: { chunks: {} } }), 'unknown');
    assert.strictEqual(detectProvider({ imagenPrompt: { imagenTurns: {} } }), 'unknown');
    assert.strictEqual(
      detectProvider({ messages: [{ versions: [], currentlySelected: 0 }] }),
      'lm-studio',
    );
    assert.strictEqual(
      detectProvider({ messages: [], usePerChatPredictionConfig: true }),
      'lm-studio',
    );
    assert.strictEqual(
      detectProvider({ conversations: [{ conversation: {}, responses: [] }] }),
      'grok',
    );
    assert.strictEqual(
      detectProvider({ conversations: [], projects: [], tasks: [], media_posts: [] }),
      'grok',
    );
  });

  it('does not infer providers from empty arrays or unrelated fields', () => {
    assert.strictEqual(detectProvider([]), 'unknown');
    assert.strictEqual(detectProvider({ conversations: [] }), 'unknown');
    assert.strictEqual(detectProvider({ turns: [], platform: 'other' }), 'unknown');
    assert.strictEqual(detectProvider({ messages: [] }), 'unknown');
    assert.strictEqual(detectProvider({ messages: [{ role: 'user' }] }), 'unknown');
  });

  it('propagates parse errors through grouping, listing, and lookup APIs', () => {
    assert.match(parseConversationGroups('{').error, /^Invalid JSON:/);
    assert.match(listConversationsFromExport('{').error, /^Invalid JSON:/);
    assert.match(getConversationFromExport('{', 'x').error, /^Invalid JSON:/);
  });

  it('parses object-wrapped Anthropic conversation arrays through the main dispatcher', () => {
    const parsed = parseConversationGroups({
      conversations: [
        {
          uuid: 'wrapped',
          name: 'Wrapped export',
          chat_messages: [
            { sender: 'human', text: 'Wrapped question' },
            { sender: 'assistant', text: 'Wrapped answer' },
          ],
        },
      ],
    });
    assert.strictEqual(parsed.error, undefined);
    assert.strictEqual(parsed.conversations.length, 1);
    assert.strictEqual(parsed.conversations[0].key, 'anthropic:wrapped');
    assert.deepStrictEqual(parsed.conversations[0].turns, [
      { user: 'Wrapped question' },
      { ai: 'Wrapped answer' },
    ]);
  });
});

describe('conversation grouping, titles, and lookup', () => {
  const anthropicExport = [
    {
      uuid: 'first-id',
      name: '  First title  ',
      chat_messages: [{ sender: 'human', text: 'First question' }],
    },
    {
      id: 'second-id',
      title: '',
      chat_messages: [{ sender: 'assistant', text: 'Second answer' }],
    },
    {
      id: 'empty-id',
      name: 'Empty',
      chat_messages: [],
    },
  ];

  it('lists non-empty conversations with keys, titles, and turn counts', () => {
    assert.deepStrictEqual(listConversationsFromExport(anthropicExport), {
      conversations: [
        { key: 'anthropic:first-id', title: 'First title', turnCount: 1 },
        { key: 'anthropic:second-id', title: 'Second answer', turnCount: 1 },
      ],
    });
  });

  it('returns grouped conversations without flattening them', () => {
    const result = parseConversationGroups(anthropicExport);
    assert.strictEqual(result.conversations.length, 2);
    assert.deepStrictEqual(result.conversations[0].turns, [{ user: 'First question' }]);
    assert.deepStrictEqual(result.conversations[1].turns, [{ ai: 'Second answer' }]);
  });

  it('looks up a conversation by provider-prefixed key', () => {
    const result = getConversationFromExport(anthropicExport, 'anthropic:second-id');
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.conversation?.title, 'Second answer');
  });

  it('uses the first conversation when the lookup key is empty', () => {
    const result = getConversationFromExport(anthropicExport, '');
    assert.strictEqual(result.conversation?.key, 'anthropic:first-id');
  });

  it('returns a precise not-found result for an absent key', () => {
    assert.deepStrictEqual(getConversationFromExport(anthropicExport, 'missing'), {
      conversation: null,
      error: 'Conversation not found: missing',
    });
  });

  it('summarizes long fallback titles to 80 characters', () => {
    const text = `first   ${'word '.repeat(30)}`;
    const result = parseConversationGroups({
      platform: 'openrouter',
      turns: [{ role: 'user', content: text }],
    });
    const title = result.conversations[0].title;
    assert.strictEqual(title.length, 80);
    assert.ok(title.endsWith('...'));
    assert.ok(!title.includes('  '));
  });
});

describe('timestamp normalization across providers', () => {
  it('normalizes seconds and milliseconds timestamps', () => {
    const seconds = parseOpenRouter({
      platform: 'openrouter',
      turns: [{ role: 'user', content: 'seconds', timestamp: 1_700_000_000 }],
    });
    const milliseconds = parseOpenRouter({
      platform: 'openrouter',
      turns: [{ role: 'user', content: 'milliseconds', timestamp: 1_700_000_000_000 }],
    });
    assert.strictEqual(seconds.turns[0].createdAt, '2023-11-14T22:13:20.000Z');
    assert.strictEqual(milliseconds.turns[0].createdAt, '2023-11-14T22:13:20.000Z');
  });

  it('normalizes numeric timestamp strings', () => {
    const result = parseOpenRouter({
      platform: 'openrouter',
      turns: [{ role: 'assistant', content: 'answer', created_at: '1700000000' }],
    });
    assert.strictEqual(result.turns[0].createdAt, '2023-11-14T22:13:20.000Z');
  });

  it('drops invalid, non-finite, non-positive, and implausibly old timestamps', () => {
    for (const timestamp of ['invalid', 0, -1, Infinity, 12345]) {
      const result = parseOpenRouter({
        platform: 'openrouter',
        turns: [{ role: 'user', content: 'question', timestamp }],
      });
      assert.deepStrictEqual(result.turns, [{ user: 'question' }]);
    }
  });

  it('prefers chunk timestamps over Google conversation defaults', () => {
    const result = parseGoogleAIStudio({
      createdAt: '2026-01-01T00:00:00Z',
      chunkedPrompt: {
        chunks: [
          { role: 'user', text: 'one' },
          { role: 'model', text: 'two', timestamp: '2026-02-01T00:00:00Z' },
        ],
      },
    });
    assert.strictEqual(result.turns[0].createdAt, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(result.turns[1].createdAt, '2026-02-01T00:00:00.000Z');
  });

  it('falls back from message timestamp to conversation timestamp for Anthropic', () => {
    const result = parseAnthropic({
      created_at: '2026-03-01T12:00:00Z',
      chat_messages: [{ sender: 'human', text: 'hello', created_at: 'bad' }],
    });
    assert.strictEqual(result.turns[0].createdAt, '2026-03-01T12:00:00.000Z');
  });
});

describe('provider-specific missing and unusual fields', () => {
  it('uses Google metadata title and omits a whitespace-only explicit title', () => {
    const result = parseConversationGroups({
      title: '   ',
      metadata: { title: 'Metadata title' },
      chunkedPrompt: { chunks: [{ role: 'user', text: 'Fallback text' }] },
    });
    assert.strictEqual(result.conversations[0].title, 'Fallback text');
  });

  it('keeps Google image turns but returns no conversation when all chunks are unusable', () => {
    assert.deepStrictEqual(
      parseConversationGroups({
        chunkedPrompt: { chunks: [{ role: 'user', driveImage: true }] },
      }).conversations[0].turns,
      [{ user: '[image]' }],
    );
    assert.deepStrictEqual(
      parseConversationGroups({
        chunkedPrompt: { chunks: [{ role: 'model', text: '   ' }] },
      }).conversations,
      [],
    );
  });

  it('parses Google Imagen prompts and generated-image placeholders with role filters', () => {
    const input = {
      runSettings: { model: 'models/imagen-test' },
      imagenPrompt: {
        imagenTurns: [
          { prompt: ' First prompt ', generatedImages: [{}] },
          { prompt: 'Second prompt', generatedImages: [] },
          { generatedImages: [{}] },
        ],
      },
    };

    assert.deepStrictEqual(parseGoogleAIStudio(input).turns, [
      { user: 'First prompt' },
      { ai: '[image]', model: 'models/imagen-test' },
      { user: 'Second prompt' },
      { ai: '[image]', model: 'models/imagen-test' },
    ]);
    assert.deepStrictEqual(parseGoogleAIStudio(input, { includeAi: false }).turns, [
      { user: 'First prompt' },
      { user: 'Second prompt' },
    ]);
    assert.deepStrictEqual(parseGoogleAIStudio(input, { includeUser: false }).turns, [
      { ai: '[image]', model: 'models/imagen-test' },
      { ai: '[image]', model: 'models/imagen-test' },
    ]);
  });

  it('extracts Anthropic thinking and text blocks in source order by category', () => {
    const result = parseAnthropic({
      chat_messages: [
        {
          sender: 'assistant',
          model_slug: 'claude-test',
          content: [
            { type: 'text', text: 'answer one' },
            { type: 'thinking', thinking: 'reason one' },
            { type: 'text', text: 'answer two' },
            { type: 'thinking', thinking: 'reason two' },
          ],
        },
      ],
    });
    assert.deepStrictEqual(result.turns, [
      { thinking: 'reason one', model: 'claude-test' },
      { thinking: 'reason two', model: 'claude-test' },
      { ai: 'answer one', model: 'claude-test' },
      { ai: 'answer two', model: 'claude-test' },
    ]);
  });

  it('uses Anthropic fallback text when content blocks contain no text', () => {
    const result = parseAnthropic({
      chat_messages: [
        {
          sender: 'assistant',
          text: 'fallback',
          content: [{ type: 'tool_use', id: 'synthetic' }],
        },
      ],
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'fallback' }]);
  });

  it('parses Anthropic project messages without indexing tool-call details twice', () => {
    const result = parseAnthropic({
      uuid: 'project-conversation',
      title: 'Project conversation',
      project: { uuid: 'project' },
      messages: [
        {
          role: 'user',
          created_at: '2026-06-10T08:00:00Z',
          content: {
            content: 'project question',
            contentBlocks: [{ type: 'text', text: 'project question' }],
          },
        },
        {
          role: 'assistant',
          created_at: '2026-06-10T08:01:00Z',
          content: {
            content: 'project answer',
            contentBlocks: [
              { type: 'tool_call', toolCall: { output: 'private tool output' } },
              { type: 'thinking', text: 'project reasoning' },
              { type: 'text', text: 'project answer' },
            ],
          },
        },
      ],
    });

    assert.deepStrictEqual(result.turns, [
      { user: 'project question', createdAt: '2026-06-10T08:00:00.000Z' },
      {
        thinking: 'project reasoning',
        createdAt: '2026-06-10T08:01:00.000Z',
      },
      { ai: 'project answer', createdAt: '2026-06-10T08:01:00.000Z' },
    ]);
  });

  it('ignores malformed Anthropic content blocks without failing', () => {
    const result = parseAnthropic({
      chat_messages: [
        {
          sender: 'assistant',
          content: [null, 7, { type: 'thinking', thinking: 8 }, { type: 'text', text: 'ok' }],
        },
      ],
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'ok' }]);
  });

  it('filters OpenAI technical artifacts while retaining near misses', () => {
    const result = parseOpenAI({
      mapping: {
        a: {
          message: {
            author: { role: 'assistant' },
            content: { content_type: 'code', parts: ['search(query)'] },
            create_time: 1,
          },
        },
        b: {
          message: {
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['research(query)'] },
            create_time: 2,
          },
        },
        c: {
          message: {
            author: { role: 'assistant' },
            content: { parts: ['{}'] },
            create_time: 3,
          },
        },
      },
    });
    assert.deepStrictEqual(result.turns, [{ ai: 'research(query)' }]);
  });

  it('prefers OpenAI metadata model over message and conversation models', () => {
    const result = parseOpenAI({
      default_model_slug: 'conversation-model',
      current_node: 'a',
      mapping: {
        a: {
          parent: null,
          message: {
            author: { role: 'assistant' },
            content: 'answer',
            model_slug: 'message-model',
            metadata: { model_slug: 'metadata-model' },
          },
        },
      },
    });
    assert.strictEqual(result.turns[0].model, 'metadata-model');
  });

  it('skips OpenAI mapping nodes without timestamps in fallback ordering', () => {
    const result = parseOpenAI({
      mapping: {
        noTime: {
          message: { author: { role: 'user' }, content: { parts: ['ignored'] } },
        },
        timed: {
          message: {
            author: { role: 'user' },
            content: { parts: ['kept'] },
            create_time: 1_700_000_000,
          },
        },
      },
    });
    assert.deepStrictEqual(result.turns, [{ user: 'kept', createdAt: '2023-11-14T22:13:20.000Z' }]);
  });

  it('uses the newest OpenAI fallback branch instead of flattening edited branches', () => {
    const result = parseOpenAI({
      mapping: {
        root: { parent: null },
        userOriginal: {
          parent: 'root',
          message: {
            author: { role: 'user' },
            content: { parts: ['original prompt'] },
            create_time: 10,
          },
        },
        abandonedAssistant: {
          parent: 'userOriginal',
          message: {
            author: { role: 'assistant' },
            content: { parts: ['abandoned answer'] },
            create_time: 20,
          },
        },
        userEdited: {
          parent: 'root',
          message: {
            author: { role: 'user' },
            content: { parts: ['edited prompt'] },
            create_time: 30,
          },
        },
        finalAssistant: {
          parent: 'userEdited',
          message: {
            author: { role: 'assistant' },
            content: { parts: ['final answer'] },
            create_time: 40,
          },
        },
      },
    });

    assert.deepStrictEqual(
      result.turns.map((turn) => turn.user ?? turn.ai),
      ['edited prompt', 'final answer'],
    );
  });

  it('trims OpenRouter role, content, and model independently', () => {
    const result = parseOpenRouter({
      platform: 'openrouter',
      turns: [{ role: ' Assistant ', content: '  answer  ', model: '  model-x  ' }],
    });
    assert.deepStrictEqual(result.turns, []);
  });

  it('uses OpenRouter message fallback and ignores unsupported object content', () => {
    const result = parseOpenRouter({
      platform: 'openrouter',
      turns: [
        { role: 'user', message: ' fallback message ' },
        { role: 'assistant', content: { text: 'not supported here' } },
      ],
    });
    assert.deepStrictEqual(result.turns, [{ user: 'fallback message' }]);
  });
});
