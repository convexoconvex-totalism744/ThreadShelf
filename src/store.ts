import { connect, type Connection, type Table } from '@lancedb/lancedb';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embed, embedOne } from './embedding.js';
import { isIndexableText } from './chunking.js';
import { portableModelLabel } from './model-label.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.LANCEDB_PATH || join(__dirname, '..', '.lancedb');
const EMBED_BATCH_SIZE = Math.max(1, Number(process.env.EMBED_BATCH_SIZE) || 25);

let db: Connection | null = null;
const tableCache = new Map<string, Table>();
const collectionWriteLocks = new Map<string, Promise<void>>();
const COLLECTION_STATS_CACHE_MS = 5_000;
const collectionStatsCache = new Map<
  string,
  { readonly expiresAt: number; readonly value: Promise<CollectionStats> }
>();

const invalidateCollectionStats = (collection: string): void => {
  collectionStatsCache.delete(collection);
};

const getDb = async (): Promise<Connection> => {
  if (!db) {
    try {
      db = await connect(DB_PATH);
    } catch (e) {
      const err = new Error((e as Error)?.message || 'LanceDB connect failed');
      err.cause = e;
      throw err;
    }
  }
  return db;
};

const openTable = async (collection: string): Promise<Table | null> => {
  const cached = tableCache.get(collection);
  if (cached) return cached;

  const database = await getDb();
  const names = await database.tableNames();
  if (!names.includes(collection)) return null;

  const opened = await database.openTable(collection);
  tableCache.set(collection, opened);
  return opened;
};

const escapeSqlString = (value: string): string => value.replace(/'/g, "''");

export interface ChunkRow {
  readonly id: string;
  readonly text: string;
  readonly sourceFile: string;
  readonly provider: string;
  readonly role: string;
  readonly turnIndex: number;
  readonly conversationKey?: string;
  readonly title?: string;
  readonly model?: string;
  readonly createdAt?: string;
  readonly createdInThreadShelf?: boolean;
  readonly generationProvider?: string;
}

interface ChunkWriteOptions {
  readonly signal?: AbortSignal;
}

interface EmbeddedChunkRow extends Record<string, unknown> {
  readonly id: string;
  readonly vector: number[];
  readonly document: string;
  readonly sourceFile: string;
  readonly provider: string;
  readonly conversationKey: string;
  readonly title: string;
  readonly role: string;
  readonly turnIndex: string;
  readonly model: string;
  readonly createdAt: string;
  readonly createdInThreadShelf: boolean;
  readonly generationProvider: string;
}

export const addChunks = async (
  collection: string,
  chunks: ChunkRow[],
  options: ChunkWriteOptions = {},
): Promise<void> => {
  if (chunks.length === 0) return;
  const rows = await embedChunks(chunks, options.signal);
  return withCollectionWriteLock(collection, async () => {
    await addEmbeddedRowsLocked(collection, rows);
    invalidateCollectionStats(collection);
  });
};

const ensureChunkMetadataSchema = async (tbl: Table): Promise<void> => {
  const schema = await tbl.schema();
  const existing = new Set(schema.fields.map((field) => field.name));
  const missing = [
    ...['provider', 'conversationKey', 'title', 'model', 'createdAt', 'generationProvider'].map(
      (name) => ({ name, valueSql: "''" }),
    ),
    { name: 'createdInThreadShelf', valueSql: 'false' },
  ].filter((column) => !existing.has(column.name));
  if (missing.length) await tbl.addColumns(missing);
};

// Delete + re-add under a single lock so two concurrent ingests of the same
// file cannot interleave into duplicated chunks.
export const replaceChunksForFile = async (
  collection: string,
  sourceFile: string,
  chunks: ChunkRow[],
  options: ChunkWriteOptions = {},
): Promise<void> => {
  // Embed before deleting the previous rows. Cancellation can therefore never
  // turn a healthy indexed file into a partially replaced one.
  const rows = await embedChunks(chunks, options.signal);
  options.signal?.throwIfAborted();
  return withCollectionWriteLock(collection, async () => {
    const tbl = await openTable(collection);
    if (tbl) {
      await tbl.delete(`sourceFile = '${escapeSqlString(sourceFile)}'`);
    }
    await addEmbeddedRowsLocked(collection, rows);
    invalidateCollectionStats(collection);
  });
};

// Re-index only the turns authored/generated inside ThreadShelf. Imported
// archive chunks stay untouched, while retries remain idempotent.
export const replaceThreadShelfChunksForConversation = async (
  collection: string,
  sourceFile: string,
  conversationKey: string,
  chunks: ChunkRow[],
): Promise<void> => {
  const rows = await embedChunks(chunks);
  return withCollectionWriteLock(collection, async () => {
    const tbl = await openTable(collection);
    if (tbl) {
      await ensureChunkMetadataSchema(tbl);
      await tbl.delete(
        [
          `sourceFile = '${escapeSqlString(sourceFile)}'`,
          `conversationKey = '${escapeSqlString(conversationKey)}'`,
          'createdInThreadShelf = true',
        ].join(' AND '),
      );
    }
    await addEmbeddedRowsLocked(collection, rows);
    invalidateCollectionStats(collection);
  });
};

const embedChunks = async (
  chunks: ChunkRow[],
  signal?: AbortSignal,
): Promise<EmbeddedChunkRow[]> => {
  if (chunks.length === 0) return [];
  const rows: EmbeddedChunkRow[] = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map((ch) => ch.text);
    const embeddings = await embed(texts);
    signal?.throwIfAborted();
    rows.push(
      ...batch.map((ch, j) => ({
        id: ch.id,
        vector: embeddings[j]!,
        document: ch.text,
        sourceFile: ch.sourceFile,
        provider: ch.provider,
        conversationKey: ch.conversationKey ?? '',
        title: ch.title ?? '',
        role: ch.role,
        turnIndex: String(ch.turnIndex),
        model: ch.model ?? '',
        createdAt: ch.createdAt ?? '',
        createdInThreadShelf: ch.createdInThreadShelf ?? false,
        generationProvider: ch.generationProvider ?? '',
      })),
    );
  }
  return rows;
};

const addEmbeddedRowsLocked = async (
  collection: string,
  rows: EmbeddedChunkRow[],
): Promise<void> => {
  if (rows.length === 0) return;
  const database = await getDb();

  for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
    const tbl = await openTable(collection);
    if (tbl) {
      await ensureChunkMetadataSchema(tbl);
      await tbl.add(batch);
    } else {
      const created = await database.createTable(collection, batch, { mode: 'create' });
      tableCache.set(collection, created);
    }
  }
};

// --- Stored threads ---
//
// Normalized conversation turns are persisted at ingest time in a single
// internal table so the thread view no longer depends on the original export
// file staying in place (or unchanged — LM Studio rewrites its files). User
// collection names can never start with an underscore (normalizeCollectionName
// strips them), so the "__" prefix is reserved for internal tables.

const THREADS_TABLE = '__threads';

export interface ThreadConversationInput {
  readonly key: string;
  readonly title: string;
  readonly turns: readonly unknown[];
  readonly createdInThreadShelf?: boolean;
  readonly threadCreatedAt?: string;
}

export interface StoredThreadRow {
  readonly collection: string;
  readonly sourceFile: string;
  readonly conversationKey: string;
  readonly title: string;
  readonly provider: string;
  readonly ordinal: number;
  readonly turnCount: number;
  readonly turnsJson: string;
  readonly ingestedAt: string;
  readonly lastTurnAt: string;
  readonly lastModel: string;
  readonly createdInThreadShelf: boolean;
  readonly threadCreatedAt: string;
  readonly hasThreadShelfTurns: boolean;
}

export interface ThreadSummaryRow {
  readonly sourceFile: string;
  readonly conversationKey: string;
  readonly title: string;
  readonly provider: string;
  readonly ordinal: number;
  readonly turnCount: number;
  readonly lastTurnAt: string;
  readonly lastModel: string;
  readonly createdInThreadShelf: boolean;
  readonly threadCreatedAt: string;
  readonly hasThreadShelfTurns: boolean;
}

export class StoredThreadWriteError extends Error {
  constructor(message = 'Stored thread changed or disappeared before it could be saved') {
    super(message);
    this.name = 'StoredThreadWriteError';
  }
}

const storedThreadRow = (row: Record<string, unknown>): StoredThreadRow => ({
  collection: (row.collection as string) ?? '',
  sourceFile: (row.sourceFile as string) ?? '',
  conversationKey: (row.conversationKey as string) ?? '',
  title: (row.title as string) ?? '',
  provider: (row.provider as string) ?? '',
  ordinal: Number(row.ordinal) || 0,
  turnCount: Number(row.turnCount) || 0,
  turnsJson: (row.turnsJson as string) ?? '',
  ingestedAt: (row.ingestedAt as string) ?? '',
  lastTurnAt: (row.lastTurnAt as string) ?? '',
  lastModel: (row.lastModel as string) ?? '',
  createdInThreadShelf: Boolean(row.createdInThreadShelf),
  threadCreatedAt: (row.threadCreatedAt as string) ?? '',
  hasThreadShelfTurns: Boolean(row.hasThreadShelfTurns || row.createdInThreadShelf),
});

// Latest turn timestamp in a conversation — powers "sort by recent" in the
// browse list without re-reading turnsJson at query time.
const latestTurnTimestamp = (turns: readonly unknown[]): string => {
  let latest = '';
  for (const turn of turns) {
    const createdAt = (turn as { createdAt?: unknown })?.createdAt;
    if (typeof createdAt === 'string' && createdAt > latest) latest = createdAt;
  }
  return latest;
};

const latestTurnModel = (turns: readonly unknown[]): string => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const model = (turns[index] as { model?: unknown })?.model;
    if (typeof model === 'string' && model.trim()) return model.trim();
  }
  return '';
};

let threadsSchemaMigration: Promise<void> | null = null;

// Schema upgrades on the request path must remain additive and bounded. In
// particular, do not backfill metadata by materializing turnsJson for every
// archived conversation: large databases would make the first request appear
// empty or hung. Existing rows use their normal ingestedAt fallbacks and gain
// the metadata naturally the next time they are written.
const migrateThreadsSchema = async (tbl: Table): Promise<void> => {
  let schema = await tbl.schema();
  if (!schema.fields.some((field) => field.name === 'lastTurnAt')) {
    try {
      await tbl.addColumns([{ name: 'lastTurnAt', valueSql: "''" }]);
    } catch (e) {
      // Another process may have added the column concurrently.
      const refreshed = await tbl.schema();
      if (!refreshed.fields.some((field) => field.name === 'lastTurnAt')) throw e;
    }
  }

  schema = await tbl.schema();
  const metadataColumns = [
    { name: 'createdInThreadShelf', valueSql: 'false' },
    { name: 'threadCreatedAt', valueSql: "''" },
    { name: 'hasThreadShelfTurns', valueSql: 'false' },
    { name: 'lastModel', valueSql: "''" },
  ].filter((column) => !schema.fields.some((field) => field.name === column.name));
  if (metadataColumns.length) {
    try {
      await tbl.addColumns(metadataColumns);
    } catch (e) {
      // A second server/watch process may have performed the same additive
      // migration between our schema read and this write.
      const refreshed = await tbl.schema();
      if (metadataColumns.some((column) => !refreshed.fields.some((f) => f.name === column.name))) {
        throw e;
      }
    }
  }
};

const ensureThreadsSchema = async (tbl: Table): Promise<void> => {
  if (!threadsSchemaMigration) {
    threadsSchemaMigration = migrateThreadsSchema(tbl).catch((error) => {
      threadsSchemaMigration = null;
      throw error;
    });
  }
  await threadsSchemaMigration;
};

export const replaceThreadsForFile = async (
  collection: string,
  sourceFile: string,
  provider: string,
  conversations: readonly ThreadConversationInput[],
): Promise<void> => {
  return withCollectionWriteLock(THREADS_TABLE, async () => {
    const ingestedAt = new Date().toISOString();
    const rows = conversations.map((conversation, ordinal) => ({
      collection,
      sourceFile,
      conversationKey: conversation.key ?? '',
      title: conversation.title ?? '',
      provider,
      ordinal,
      turnCount: conversation.turns.length,
      turnsJson: JSON.stringify(conversation.turns),
      ingestedAt,
      lastTurnAt: latestTurnTimestamp(conversation.turns),
      lastModel: latestTurnModel(conversation.turns),
      createdInThreadShelf: conversation.createdInThreadShelf ?? false,
      threadCreatedAt: conversation.threadCreatedAt ?? '',
      hasThreadShelfTurns:
        conversation.createdInThreadShelf === true ||
        conversation.turns.some(
          (turn) => (turn as { createdInThreadShelf?: unknown })?.createdInThreadShelf === true,
        ),
    }));

    const tbl = await openTable(THREADS_TABLE);
    if (tbl) {
      await ensureThreadsSchema(tbl);
      await tbl.delete(
        `collection = '${escapeSqlString(collection)}' AND sourceFile = '${escapeSqlString(sourceFile)}'`,
      );
      if (rows.length) await tbl.add(rows);
    } else if (rows.length) {
      const database = await getDb();
      const created = await database.createTable(THREADS_TABLE, rows, { mode: 'create' });
      tableCache.set(THREADS_TABLE, created);
    }
    invalidateCollectionStats(collection);
  });
};

export const updateStoredThread = async (
  collection: string,
  sourceFile: string,
  provider: string,
  conversation: ThreadConversationInput,
): Promise<void> => {
  return withCollectionWriteLock(THREADS_TABLE, async () => {
    const tbl = await openTable(THREADS_TABLE);
    if (!tbl) throw new Error('Stored thread table is unavailable');
    await ensureThreadsSchema(tbl);
    const ingestedAt = new Date().toISOString();
    const result = await tbl.update({
      where: [
        `collection = '${escapeSqlString(collection)}'`,
        `sourceFile = '${escapeSqlString(sourceFile)}'`,
        `conversationKey = '${escapeSqlString(conversation.key)}'`,
      ].join(' AND '),
      values: {
        title: conversation.title,
        provider,
        turnCount: conversation.turns.length,
        turnsJson: JSON.stringify(conversation.turns),
        ingestedAt,
        lastTurnAt: latestTurnTimestamp(conversation.turns),
        lastModel: latestTurnModel(conversation.turns),
        createdInThreadShelf: conversation.createdInThreadShelf ?? false,
        threadCreatedAt: conversation.threadCreatedAt ?? '',
        hasThreadShelfTurns:
          conversation.createdInThreadShelf === true ||
          conversation.turns.some(
            (turn) => (turn as { createdInThreadShelf?: unknown })?.createdInThreadShelf === true,
          ),
      },
    });
    if (result.rowsUpdated !== 1) throw new StoredThreadWriteError();
    invalidateCollectionStats(collection);
  });
};

export const updateStoredThreadFromCurrent = async (
  collection: string,
  sourceFile: string,
  conversationKey: string,
  update: (current: StoredThreadRow) => {
    readonly provider: string;
    readonly conversation: ThreadConversationInput;
  },
): Promise<ThreadConversationInput> => {
  return withCollectionWriteLock(THREADS_TABLE, async () => {
    const tbl = await openTable(THREADS_TABLE);
    if (!tbl) throw new StoredThreadWriteError('Stored thread table is unavailable');
    await ensureThreadsSchema(tbl);
    const where = [
      `collection = '${escapeSqlString(collection)}'`,
      `sourceFile = '${escapeSqlString(sourceFile)}'`,
      `conversationKey = '${escapeSqlString(conversationKey)}'`,
    ].join(' AND ');
    const rows = await tbl.query().where(where).limit(2).toArray();
    if (rows.length !== 1) throw new StoredThreadWriteError();
    const next = update(storedThreadRow(rows[0] as Record<string, unknown>));
    const conversation = next.conversation;
    const result = await tbl.update({
      where,
      values: {
        title: conversation.title,
        provider: next.provider,
        turnCount: conversation.turns.length,
        turnsJson: JSON.stringify(conversation.turns),
        ingestedAt: new Date().toISOString(),
        lastTurnAt: latestTurnTimestamp(conversation.turns),
        lastModel: latestTurnModel(conversation.turns),
        createdInThreadShelf: conversation.createdInThreadShelf ?? false,
        threadCreatedAt: conversation.threadCreatedAt ?? '',
        hasThreadShelfTurns:
          conversation.createdInThreadShelf === true ||
          conversation.turns.some(
            (turn) => (turn as { createdInThreadShelf?: unknown })?.createdInThreadShelf === true,
          ),
      },
    });
    if (result.rowsUpdated !== 1) throw new StoredThreadWriteError();
    invalidateCollectionStats(collection);
    return conversation;
  });
};

export const getStoredThreads = async (
  collection: string | null,
  sourceFile: string,
): Promise<StoredThreadRow[]> => {
  try {
    const tbl = await openTable(THREADS_TABLE);
    if (!tbl) return [];
    await ensureThreadsSchema(tbl);
    const fileFilter = `sourceFile = '${escapeSqlString(sourceFile)}'`;
    const where = collection
      ? `collection = '${escapeSqlString(collection)}' AND ${fileFilter}`
      : fileFilter;
    const rows = await tbl.query().where(where).limit(Number.MAX_SAFE_INTEGER).toArray();
    return rows
      .map((row) => storedThreadRow(row as Record<string, unknown>))
      .sort((a, b) => a.ordinal - b.ordinal);
  } catch (error) {
    console.warn('[store:getStoredThreads]', error);
    return [];
  }
};

export const listThreadSummaries = async (collection: string): Promise<ThreadSummaryRow[]> => {
  try {
    const tbl = await openTable(THREADS_TABLE);
    if (!tbl) return [];
    await ensureThreadsSchema(tbl);
    const baseColumns = [
      'sourceFile',
      'conversationKey',
      'title',
      'provider',
      'ordinal',
      'turnCount',
      'createdInThreadShelf',
      'threadCreatedAt',
      'hasThreadShelfTurns',
      'lastModel',
    ];
    const fetch = (columns: string[]) =>
      tbl
        .query()
        .where(`collection = '${escapeSqlString(collection)}'`)
        .select(columns)
        .limit(Number.MAX_SAFE_INTEGER)
        .toArray();

    let rows: Record<string, unknown>[];
    try {
      rows = await fetch([...baseColumns, 'lastTurnAt']);
    } catch (e) {
      // __threads created before the lastTurnAt column existed.
      if (!String((e as Error)?.message || '').includes('lastTurnAt')) throw e;
      rows = await fetch(baseColumns);
    }
    return rows.map((row) => ({
      sourceFile: (row.sourceFile as string) ?? '',
      conversationKey: (row.conversationKey as string) ?? '',
      title: (row.title as string) ?? '',
      provider: (row.provider as string) ?? '',
      ordinal: Number(row.ordinal) || 0,
      turnCount: Number(row.turnCount) || 0,
      lastTurnAt: (row.lastTurnAt as string) ?? '',
      lastModel: (row.lastModel as string) ?? '',
      createdInThreadShelf: Boolean(row.createdInThreadShelf),
      threadCreatedAt: (row.threadCreatedAt as string) ?? '',
      hasThreadShelfTurns: Boolean(row.hasThreadShelfTurns || row.createdInThreadShelf),
    }));
  } catch (error) {
    console.warn('[store:listThreadSummaries]', error);
    return [];
  }
};

export const deleteThreadsForCollection = async (collection: string): Promise<void> => {
  return withCollectionWriteLock(THREADS_TABLE, async () => {
    const tbl = await openTable(THREADS_TABLE);
    if (!tbl) return;
    await ensureThreadsSchema(tbl);
    await tbl.delete(`collection = '${escapeSqlString(collection)}'`);
    invalidateCollectionStats(collection);
  });
};

export interface SearchResult {
  readonly id: string;
  readonly document: string;
  readonly metadata: {
    readonly sourceFile: string;
    readonly provider?: string;
    readonly conversationKey?: string;
    readonly title?: string;
    readonly role: string;
    readonly turnIndex: string;
    readonly model?: string;
    readonly createdAt?: string;
    readonly createdInThreadShelf?: boolean;
    readonly generationProvider?: string;
    readonly collection?: string;
  };
  readonly distance?: number;
}

export interface SearchOptions {
  readonly n?: number;
  readonly roles?: string[];
  readonly keywordBoost?: boolean;
  readonly model?: string;
  readonly from?: string;
  readonly to?: string;
  readonly origin?: 'threadshelf' | 'archive';
}

export const searchCollection = async (
  collection: string,
  query: string,
  opts: SearchOptions = {},
  queryEmbedding?: number[],
): Promise<SearchResult[]> => {
  const n = opts.n ?? 15;
  const roles = opts.roles?.length ? opts.roles : null;
  const modelFilter = normalizeModelFilter(opts.model);
  const dateFilter = buildCreatedAtFilter(opts.from, opts.to);
  const keywordBoost = opts.keywordBoost === true;
  const needsPostFilter = roles || modelFilter || keywordBoost;
  const limit = needsPostFilter ? Math.min(Math.max(n * 8, 80), 200) : n;
  const embedding = queryEmbedding ?? (await embedOne(query));

  const tbl = await openTable(collection);
  if (!tbl) return [];
  await ensureChunkMetadataSchema(tbl);

  const filters = [
    dateFilter,
    opts.origin ? `createdInThreadShelf = ${opts.origin === 'threadshelf'}` : '',
  ].filter(Boolean);
  const results = await vectorSearchRows(tbl, embedding, limit, filters.join(' AND '));

  let rows: SearchResult[] = results.map((row) => ({
    id: row.id as string,
    document: (row.document as string) ?? '',
    metadata: {
      sourceFile: row.sourceFile as string,
      provider: (row.provider as string) || undefined,
      conversationKey: (row.conversationKey as string) || undefined,
      title: (row.title as string) || undefined,
      role: row.role as string,
      turnIndex: row.turnIndex as string,
      model: portableModelLabel((row.model as string) || undefined) || undefined,
      createdAt: (row.createdAt as string) || undefined,
      createdInThreadShelf: Boolean(row.createdInThreadShelf),
      generationProvider: (row.generationProvider as string) || undefined,
    },
    distance: row._distance as number | undefined,
  }));

  if (roles?.length) {
    const roleSet = new Set(roles);
    rows = rows.filter((r) => roleSet.has(r.metadata.role));
  }

  if (opts.origin) {
    const expected = opts.origin === 'threadshelf';
    rows = rows.filter((row) => row.metadata.createdInThreadShelf === expected);
  }

  rows = rows.filter((r) => isSearchableDocument(r.document));

  if (modelFilter) {
    rows = rows.filter((r) => normalizeModelFilter(r.metadata.model)?.includes(modelFilter));
  }

  if (keywordBoost && query.trim()) {
    const q = query.trim().toLowerCase();
    rows.sort((a, b) => {
      const aHas = a.document.toLowerCase().includes(q);
      const bHas = b.document.toLowerCase().includes(q);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return (a.distance ?? 0) - (b.distance ?? 0);
    });
  }

  return rows.slice(0, n);
};

// Exact-match (keyword) search: a case-insensitive substring scan pushed down
// to LanceDB as a LIKE filter. Complements vector search for identifiers,
// error strings, and code fragments the embedding model blurs away.

const escapeLikePattern = (value: string): string =>
  escapeSqlString(value).replace(/[\\%_]/g, '\\$&');

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
};

export const keywordResultComparator =
  (query: string) =>
  (a: SearchResult, b: SearchResult): number => {
    const needle = query.trim().toLowerCase();
    const diff =
      countOccurrences(b.document.toLowerCase(), needle) -
      countOccurrences(a.document.toLowerCase(), needle);
    if (diff !== 0) return diff;
    return (b.metadata.createdAt ?? '').localeCompare(a.metadata.createdAt ?? '');
  };

export const keywordSearchCollection = async (
  collection: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> => {
  const n = opts.n ?? 15;
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const tbl = await openTable(collection);
  if (!tbl) return [];
  await ensureChunkMetadataSchema(tbl);

  const clauses = [`lower(document) LIKE '%${escapeLikePattern(needle)}%'`];
  if (opts.roles?.length) {
    clauses.push(`role IN (${opts.roles.map((role) => `'${escapeSqlString(role)}'`).join(', ')})`);
  }
  const dateFilter = buildCreatedAtFilter(opts.from, opts.to);
  if (dateFilter) clauses.push(dateFilter);
  if (opts.origin) clauses.push(`createdInThreadShelf = ${opts.origin === 'threadshelf'}`);

  // Cap the scan the same way post-filtered vector search does; ranking picks
  // the best n from that window.
  const limit = Math.min(Math.max(n * 8, 80), 200);

  let results: Record<string, unknown>[];
  try {
    results = await tbl.query().where(clauses.join(' AND ')).limit(limit).toArray();
  } catch (e) {
    if (dateFilter && String((e as Error)?.message || '').includes('createdAt')) return [];
    throw e;
  }

  const modelFilter = normalizeModelFilter(opts.model);
  let rows: SearchResult[] = results.map((row) => ({
    id: row.id as string,
    document: (row.document as string) ?? '',
    metadata: {
      sourceFile: row.sourceFile as string,
      provider: (row.provider as string) || undefined,
      conversationKey: (row.conversationKey as string) || undefined,
      title: (row.title as string) || undefined,
      role: row.role as string,
      turnIndex: row.turnIndex as string,
      model: portableModelLabel((row.model as string) || undefined) || undefined,
      createdAt: (row.createdAt as string) || undefined,
      createdInThreadShelf: Boolean(row.createdInThreadShelf),
      generationProvider: (row.generationProvider as string) || undefined,
    },
  }));

  rows = rows.filter((r) => isSearchableDocument(r.document));
  if (modelFilter) {
    rows = rows.filter((r) => normalizeModelFilter(r.metadata.model)?.includes(modelFilter));
  }

  rows.sort(keywordResultComparator(query));
  return rows.slice(0, n);
};

export interface ChunkMetaRow {
  readonly createdAt: string;
  readonly model: string;
  readonly role: string;
}

// Lightweight metadata scan powering the insights dashboard: three small
// string columns, no vectors and no document text.
export const scanChunkMeta = async (collection: string): Promise<ChunkMetaRow[]> => {
  try {
    const tbl = await openTable(collection);
    if (!tbl) return [];
    const fetch = (columns: string[]) =>
      tbl.query().select(columns).limit(Number.MAX_SAFE_INTEGER).toArray();

    let rows: Record<string, unknown>[];
    try {
      rows = await fetch(['createdAt', 'model', 'role']);
    } catch (e) {
      // Tables indexed before model/createdAt existed.
      if (!String((e as Error)?.message || '').includes('No field named')) throw e;
      rows = await fetch(['role']);
    }
    return rows.map((row) => ({
      createdAt: (row.createdAt as string) ?? '',
      model: portableModelLabel((row.model as string) ?? ''),
      role: (row.role as string) ?? '',
    }));
  } catch (error) {
    console.warn(`[store:scanChunkMeta:${collection}]`, error);
    return [];
  }
};

export const listSourceFilesInCollection = async (collection: string): Promise<string[]> => {
  try {
    const tbl = await openTable(collection);
    if (!tbl) return [];
    const rows = await tbl.query().select(['sourceFile']).limit(Number.MAX_SAFE_INTEGER).toArray();
    const files = new Set<string>();
    for (const row of rows) {
      if (row.sourceFile) files.add(row.sourceFile as string);
    }
    return [...files].sort();
  } catch (error) {
    console.warn(`[store:listSourceFiles:${collection}]`, error);
    return [];
  }
};

export interface CollectionStats {
  readonly collection: string;
  readonly files: number;
  readonly conversations: number;
  readonly chunks: number;
  readonly roles: { user: number; thinking: number; ai: number };
  readonly isEmpty: boolean;
}

const computeCollectionStats = async (collection: string): Promise<CollectionStats> => {
  try {
    const tbl = await openTable(collection);
    const conversations = (await listThreadSummaries(collection)).length;
    if (!tbl) {
      return {
        collection,
        files: 0,
        conversations,
        chunks: 0,
        roles: { user: 0, thinking: 0, ai: 0 },
        isEmpty: true,
      };
    }

    // Counts run natively in LanceDB; only the distinct-file scan materializes
    // rows (a single column) in JS.
    const [chunks, user, thinking, ai, sourceFiles] = await Promise.all([
      tbl.countRows(),
      tbl.countRows("role = 'user'"),
      tbl.countRows("role = 'thinking'"),
      tbl.countRows("role = 'ai'"),
      listSourceFilesInCollection(collection),
    ]);

    return {
      collection,
      files: sourceFiles.length,
      conversations,
      chunks,
      roles: { user, thinking, ai },
      isEmpty: chunks === 0,
    };
  } catch (error) {
    console.warn(`[store:getCollectionStats:${collection}]`, error);
    return {
      collection,
      files: 0,
      conversations: 0,
      chunks: 0,
      roles: { user: 0, thinking: 0, ai: 0 },
      isEmpty: true,
    };
  }
};

export const getCollectionStats = async (collection: string): Promise<CollectionStats> => {
  const cached = collectionStatsCache.get(collection);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = computeCollectionStats(collection).catch((error) => {
    collectionStatsCache.delete(collection);
    throw error;
  });
  collectionStatsCache.set(collection, {
    expiresAt: Date.now() + COLLECTION_STATS_CACHE_MS,
    value,
  });
  return value;
};

export const listCollections = async (): Promise<string[]> => {
  try {
    const database = await getDb();
    const names = await database.tableNames();
    // "__"-prefixed tables are internal (e.g. __threads), never user collections.
    return names.filter((name) => name !== 'Default' && !name.startsWith('__')).sort();
  } catch (error) {
    console.warn('[store:listCollections]', error);
    return [];
  }
};

// Drop runs under the per-collection write lock so a reset cannot interleave
// with a concurrent ingest's delete+add on the same collection.
export const dropCollection = async (name: string): Promise<void> => {
  return withCollectionWriteLock(name, async () => {
    const database = await getDb();
    try {
      await database.dropTable(name);
    } catch {
      // table may not exist
    }
    tableCache.delete(name);
    invalidateCollectionStats(name);
    await deleteThreadsForCollection(name);
  });
};

export const resetCollection = async (collection: string): Promise<void> => {
  return dropCollection(collection);
};

// --- internals ---

const vectorSearchRows = async (
  tbl: Table,
  queryEmbedding: number[],
  limit: number,
  rowFilter = '',
): Promise<Record<string, unknown>[]> => {
  const base = () => {
    const query = tbl.vectorSearch(queryEmbedding).distanceType('cosine');
    const filtered = rowFilter ? query.where(rowFilter) : query;
    return filtered.limit(limit);
  };

  try {
    return await base()
      .select([
        'id',
        'document',
        'sourceFile',
        'provider',
        'conversationKey',
        'title',
        'role',
        'turnIndex',
        'model',
        'createdAt',
        'createdInThreadShelf',
        'generationProvider',
        '_distance',
      ])
      .toArray();
  } catch (e) {
    if (rowFilter && String((e as Error)?.message || '').includes('createdAt')) return [];
    if (!String((e as Error)?.message || '').includes('No field named')) throw e;
    try {
      return await base()
        .select([
          'id',
          'document',
          'sourceFile',
          'provider',
          'conversationKey',
          'title',
          'role',
          'turnIndex',
          '_distance',
        ])
        .toArray();
    } catch (inner) {
      if (!String((inner as Error)?.message || '').includes('No field named')) throw inner;
      try {
        return await base()
          .select(['id', 'document', 'sourceFile', 'provider', 'role', 'turnIndex', '_distance'])
          .toArray();
      } catch (legacy) {
        if (!String((legacy as Error)?.message || '').includes('No field named')) throw legacy;
        return base()
          .select(['id', 'document', 'sourceFile', 'role', 'turnIndex', '_distance'])
          .toArray();
      }
    }
  }
};

const buildCreatedAtFilter = (from: string | undefined, to: string | undefined): string => {
  const clauses = ["createdAt != ''"];
  if (from) clauses.push(`createdAt >= '${escapeSqlString(from)}'`);
  if (to) clauses.push(`createdAt <= '${escapeSqlString(to)}'`);
  return clauses.length > 1 ? clauses.join(' AND ') : '';
};

const normalizeModelFilter = (value: string | undefined): string => {
  if (value === undefined || value === null) return '';
  return portableModelLabel(String(value)).toLowerCase();
};

const isSearchableDocument = (text: string): boolean => {
  if (!isIndexableText(text)) return false;
  return text.trim().length >= 8;
};

const withCollectionWriteLock = async <T>(collection: string, fn: () => Promise<T>): Promise<T> => {
  const previous = collectionWriteLocks.get(collection) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  collectionWriteLocks.set(collection, chained);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (collectionWriteLocks.get(collection) === chained) {
      collectionWriteLocks.delete(collection);
    }
  }
};
