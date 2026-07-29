import { Router } from 'express';
import { getInsights } from '../services/insights.js';
import { ValidationError, normalizeCollectionSelector } from '../validation.js';

const router = Router();

router.get('/api/insights', async (req, res) => {
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
    res.json(await getInsights(collection));
  } catch (e) {
    console.error('[/api/insights]', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
