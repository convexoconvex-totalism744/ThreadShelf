import {
  getCollectionStats,
  listThreadSummaries,
  scanChunkMeta,
  type ThreadSummaryRow,
} from '../store.js';
import { getAllCollections } from './collections.js';

// Archive insights: everything here is derived from data already stored at
// ingest time (__threads summaries + chunk metadata) — no source-file I/O.

export interface ActivityBucket {
  readonly month: string; // "2026-03"
  readonly count: number;
}

export interface ModelCount {
  readonly model: string;
  readonly count: number;
}

export interface ProviderInsight {
  readonly provider: string;
  readonly conversations: number;
  readonly turns: number;
}

export interface LongestThread {
  readonly collection: string;
  readonly sourceFile: string;
  readonly conversationKey: string;
  readonly title: string;
  readonly provider: string;
  readonly turnCount: number;
  readonly lastTurnAt: string;
}

export interface ArchiveInsights {
  readonly collection: string;
  readonly totals: {
    readonly collections: number;
    readonly files: number;
    readonly chunks: number;
    readonly conversations: number;
    readonly turns: number;
  };
  readonly roles: { readonly user: number; readonly thinking: number; readonly ai: number };
  readonly activity: ActivityBucket[];
  readonly topModels: ModelCount[];
  readonly providers: ProviderInsight[];
  readonly longestThreads: LongestThread[];
  readonly firstActivity: string | null;
  readonly lastActivity: string | null;
}

const TOP_MODELS = 10;
const TOP_THREADS = 10;

const normalizeModelName = (model: string): string => model.replace(/^models\//, '').trim();

const monthOf = (iso: string): string | null => {
  // createdAt is a normalized ISO string; anything shorter is unusable.
  return /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : null;
};

// Fill gaps so the chart shows a continuous timeline (quiet months at zero).
const fillMonthGaps = (buckets: Map<string, number>): ActivityBucket[] => {
  const months = [...buckets.keys()].sort();
  if (months.length === 0) return [];
  const [first] = months;
  const last = months[months.length - 1]!;
  const out: ActivityBucket[] = [];
  let [year, month] = first!.split('-').map(Number) as [number, number];
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    out.push({ month: key, count: buckets.get(key) ?? 0 });
    if (key === last || out.length > 600) break;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return out;
};

export const getInsights = async (collection: string): Promise<ArchiveInsights> => {
  const collections = collection === 'all' ? await getAllCollections() : [collection];

  const [statsList, summariesList, chunkMetaList] = await Promise.all([
    Promise.all(collections.map((name) => getCollectionStats(name))),
    Promise.all(collections.map((name) => listThreadSummaries(name))),
    Promise.all(collections.map((name) => scanChunkMeta(name))),
  ]);

  const totals = { collections: 0, files: 0, chunks: 0, conversations: 0, turns: 0 };
  const roles = { user: 0, thinking: 0, ai: 0 };
  for (const stats of statsList) {
    totals.files += stats.files;
    totals.chunks += stats.chunks;
    roles.user += stats.roles.user;
    roles.thinking += stats.roles.thinking;
    roles.ai += stats.roles.ai;
    if (!stats.isEmpty) totals.collections++;
  }

  const providerMap = new Map<string, { conversations: number; turns: number }>();
  const longest: LongestThread[] = [];
  for (let i = 0; i < collections.length; i++) {
    const summaries: ThreadSummaryRow[] = summariesList[i] ?? [];
    totals.conversations += summaries.length;
    for (const row of summaries) {
      totals.turns += row.turnCount;
      const provider = row.provider || 'unknown';
      const entry = providerMap.get(provider) ?? { conversations: 0, turns: 0 };
      entry.conversations++;
      entry.turns += row.turnCount;
      providerMap.set(provider, entry);
      longest.push({
        collection: collections[i]!,
        sourceFile: row.sourceFile,
        conversationKey: row.conversationKey,
        title: row.title,
        provider: row.provider,
        turnCount: row.turnCount,
        lastTurnAt: row.lastTurnAt,
      });
    }
  }
  longest.sort((a, b) => b.turnCount - a.turnCount);

  const activityBuckets = new Map<string, number>();
  const modelCounts = new Map<string, number>();
  let firstActivity: string | null = null;
  let lastActivity: string | null = null;
  for (const rows of chunkMetaList) {
    for (const row of rows) {
      const month = monthOf(row.createdAt);
      if (month) {
        activityBuckets.set(month, (activityBuckets.get(month) ?? 0) + 1);
        if (!firstActivity || row.createdAt < firstActivity) firstActivity = row.createdAt;
        if (!lastActivity || row.createdAt > lastActivity) lastActivity = row.createdAt;
      }
      const model = normalizeModelName(row.model);
      if (model) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }
  }

  const topModels = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_MODELS);

  const providers = [...providerMap.entries()]
    .map(([provider, entry]) => ({ provider, ...entry }))
    .sort((a, b) => b.turns - a.turns);

  return {
    collection,
    totals,
    roles,
    activity: fillMonthGaps(activityBuckets),
    topModels,
    providers,
    longestThreads: longest.slice(0, TOP_THREADS),
    firstActivity,
    lastActivity,
  };
};
