import { chunkTurns } from '../chunking.js';
import { replaceThreadShelfChunksForConversation, type ChunkRow } from '../store.js';
import type { Turn } from '../validation.js';

export interface ThreadShelfIndexTarget {
  readonly collection: string;
  readonly sourceFile: string;
  readonly conversationKey: string;
  readonly title: string;
  readonly turns: readonly Turn[];
}

export const indexThreadShelfTurns = async (target: ThreadShelfIndexTarget): Promise<number> => {
  const chunks = chunkTurns([...target.turns], {
    sourceFile: target.sourceFile,
    provider: 'threadshelf',
    conversationKey: target.conversationKey,
    title: target.title,
  }).filter((chunk) => target.turns[chunk.turnIndex]?.createdInThreadShelf === true);

  const rows: ChunkRow[] = chunks.map((chunk, index) => ({
    ...chunk,
    id: `${target.sourceFile}|${target.conversationKey}|threadshelf|${chunk.turnIndex}|${index}`,
    createdInThreadShelf: true,
  }));

  await replaceThreadShelfChunksForConversation(
    target.collection,
    target.sourceFile,
    target.conversationKey,
    rows,
  );
  return rows.length;
};
