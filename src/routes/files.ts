import { Router } from 'express';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import {
  listSourceFilesInCollection,
  listThreadSummaries,
  type ThreadSummaryRow,
} from '../store.js';
import { listConversationsFromExport } from '../parser.js';
import { getAllCollections } from '../services/collections.js';
import { ValidationError, normalizeCollectionSelector } from '../validation.js';

const router = Router();
// Parsed-export cache keyed by collection+file. Bounded so a long-running
// server browsing many collections cannot grow it without limit; on overflow
// the oldest half is evicted (Map preserves insertion order).
const FILE_PARSE_CACHE_MAX = 512;
const fileParseCache = new Map<
  string,
  { readonly mtimeMs: number; readonly files: ExpandedFile[] }
>();

const pruneFileParseCache = (): void => {
  if (fileParseCache.size < FILE_PARSE_CACHE_MAX) return;
  const evict = Math.ceil(FILE_PARSE_CACHE_MAX / 2);
  for (const key of [...fileParseCache.keys()].slice(0, evict)) {
    fileParseCache.delete(key);
  }
};

interface ExpandedFile {
  readonly sourceFile: string;
  readonly collection: string;
  readonly conversationKey: string;
  readonly title: string;
  readonly turnCount: number;
  readonly provider?: string;
  readonly lastTurnAt?: string;
  readonly createdInThreadShelf?: boolean;
  readonly hasThreadShelfTurns?: boolean;
}

const expandFile = async (sourceFile: string, collection: string): Promise<ExpandedFile[]> => {
  const info = await stat(sourceFile);
  const cacheKey = `${collection}\0${sourceFile}`;
  const cached = fileParseCache.get(cacheKey);
  if (cached && cached.mtimeMs === info.mtimeMs) {
    return cached.files;
  }

  const raw = await readFile(sourceFile, 'utf-8');
  const parsed = listConversationsFromExport(raw);
  if (parsed.error || !parsed.conversations.length) {
    const fallback = [
      {
        sourceFile,
        collection,
        conversationKey: '',
        title: basename(sourceFile),
        turnCount: 0,
      },
    ];
    pruneFileParseCache();
    fileParseCache.set(cacheKey, { mtimeMs: info.mtimeMs, files: fallback });
    return fallback;
  }
  const expanded = parsed.conversations.map((conversation) => ({
    sourceFile,
    collection,
    conversationKey: conversation.key,
    title: conversation.title,
    turnCount: conversation.turnCount,
  }));
  pruneFileParseCache();
  fileParseCache.set(cacheKey, { mtimeMs: info.mtimeMs, files: expanded });
  return expanded;
};

// A source file may have been moved, rewritten, or deleted after indexing (e.g.
// LM Studio rewrites its conversation files as you keep chatting). Never let one
// unreadable file reject the whole listing — fall back to a minimal entry so the
// rest of the conversations still show.
const expandFileSafe = async (sourceFile: string, collection: string): Promise<ExpandedFile[]> => {
  try {
    return await expandFile(sourceFile, collection);
  } catch {
    return [
      {
        sourceFile,
        collection,
        conversationKey: '',
        title: basename(sourceFile),
        turnCount: 0,
      },
    ];
  }
};

// Conversations indexed since threads storage exists are listed straight from
// the __threads table (no file I/O). Files indexed before that fall back to
// re-parsing the export on disk.
const listCollectionFiles = async (collection: string): Promise<ExpandedFile[]> => {
  const [sourceFiles, summaries] = await Promise.all([
    listSourceFilesInCollection(collection),
    listThreadSummaries(collection),
  ]);

  const bySource = new Map<string, ThreadSummaryRow[]>();
  for (const summary of summaries) {
    const group = bySource.get(summary.sourceFile) ?? [];
    group.push(summary);
    bySource.set(summary.sourceFile, group);
  }

  // __threads is authoritative for normalized conversations. Chunk tables are
  // only a search index and can legitimately lag behind (empty/new chats or a
  // temporarily failed embedding), so never use them as the listing's root.
  const knownSources = new Set([...sourceFiles, ...summaries.map((row) => row.sourceFile)]);

  const expanded = await Promise.all(
    [...knownSources].sort().map(async (sourceFile) => {
      const rows = bySource.get(sourceFile);
      if (rows?.length) {
        return [...rows]
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((row) => ({
            sourceFile,
            collection,
            conversationKey: row.conversationKey,
            title: row.title || basename(sourceFile),
            turnCount: row.turnCount,
            provider: row.provider || undefined,
            lastTurnAt: row.lastTurnAt || undefined,
            createdInThreadShelf: row.createdInThreadShelf,
            hasThreadShelfTurns: row.hasThreadShelfTurns,
          }));
      }
      return expandFileSafe(sourceFile, collection);
    }),
  );
  return expanded.flat();
};

router.get('/api/files', async (req, res) => {
  let collection: string;
  try {
    collection = normalizeCollectionSelector(req.query?.collection);
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ error: e.message, field: e.field });
    }
    throw e;
  }

  try {
    const collections = collection === 'all' ? await getAllCollections() : [collection];
    const files = (await Promise.all(collections.map(listCollectionFiles))).flat();
    res.json({ files });
  } catch (e) {
    console.error('[/api/files]', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
