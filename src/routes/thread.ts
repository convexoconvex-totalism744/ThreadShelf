import { Router } from 'express';
import { loadThread, NotFoundError, BadRequestError } from '../services/thread.js';
import { ValidationError, normalizeCollectionSelector } from '../validation.js';

const router = Router();

router.get('/api/thread', async (req, res) => {
  const sourceFile = req.query?.sourceFile;
  const conversationKey = req.query?.conversationKey;

  let collection: string;
  try {
    collection = normalizeCollectionSelector(req.query?.collection);
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ error: e.message, field: e.field });
    }
    throw e;
  }

  if (!sourceFile || typeof sourceFile !== 'string') {
    return res.status(400).json({ error: 'Missing sourceFile' });
  }
  if (sourceFile.includes('\0') || sourceFile.length > 4096) {
    return res.status(400).json({ error: 'Invalid sourceFile' });
  }
  if (
    conversationKey != null &&
    (typeof conversationKey !== 'string' ||
      conversationKey.includes('\0') ||
      conversationKey.length > 4096)
  ) {
    return res.status(400).json({ error: 'Invalid conversationKey' });
  }

  try {
    const thread = await loadThread(
      sourceFile,
      collection,
      typeof conversationKey === 'string' ? conversationKey : undefined,
    );
    res.json(thread);
  } catch (e) {
    if (e instanceof NotFoundError) return res.status(404).json({ error: e.message });
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    console.error('[/api/thread]', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
