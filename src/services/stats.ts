import { getCollectionStats, type CollectionStats } from '../store.js';
import { getAllCollections } from './collections.js';

export interface AllCollectionsStats {
  readonly collection: 'all';
  readonly files: number;
  readonly conversations: number;
  readonly chunks: number;
  readonly roles: { readonly user: number; readonly thinking: number; readonly ai: number };
  readonly indexedCollections: number;
  readonly totalCollections: number;
  readonly isEmpty: boolean;
  readonly collections: CollectionStats[];
}

export const getAllCollectionStats = async (): Promise<AllCollectionsStats> => {
  const collections = await getAllCollections();
  const stats = await Promise.all(collections.map((name) => getCollectionStats(name)));
  const totals = {
    files: 0,
    conversations: 0,
    chunks: 0,
    roles: { user: 0, thinking: 0, ai: 0 },
    indexedCollections: 0,
  };

  for (const item of stats) {
    totals.files += item.files;
    totals.conversations += item.conversations;
    totals.chunks += item.chunks;
    totals.roles.user += item.roles.user;
    totals.roles.thinking += item.roles.thinking;
    totals.roles.ai += item.roles.ai;
    if (!item.isEmpty) totals.indexedCollections++;
  }

  return {
    collection: 'all',
    ...totals,
    totalCollections: collections.length,
    isEmpty: totals.chunks === 0,
    collections: stats,
  };
};

export const getStatsForCollection = async (
  collection: string,
): Promise<CollectionStats | AllCollectionsStats> => {
  if (collection === 'all') return getAllCollectionStats();
  return getCollectionStats(collection);
};
