import { Router } from 'express';
import { searchAcrossCollections } from '../services/search.js';
import {
  ValidationError,
  normalizeCollectionSelector,
  normalizeQuery,
  normalizeCount,
  normalizeRoles,
  normalizeBoolean,
  normalizeOptionalString,
  normalizeDateRange,
  normalizeSearchMode,
  type SearchMode,
} from '../validation.js';

const router = Router();

router.get('/api/search', async (req, res) => {
  let q: string;
  let collection: string;
  let n: number;
  let roles: string[] | null;
  let keywordBoost: boolean;
  let model: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let mode: SearchMode;
  let origin: 'threadshelf' | 'archive' | undefined;

  try {
    q = normalizeQuery(req.query?.q);
    collection = normalizeCollectionSelector(req.query?.collection);
    n = normalizeCount(req.query?.n, { defaultValue: 15 });
    roles = normalizeRoles(req.query?.roles) || null;
    keywordBoost = normalizeBoolean(req.query?.keywordBoost, { field: 'keywordBoost' });
    model = normalizeOptionalString(req.query?.model, { field: 'model' });
    ({ from, to } = normalizeDateRange(req.query?.from, req.query?.to));
    mode = normalizeSearchMode(req.query?.mode);
    const rawOrigin = normalizeOptionalString(req.query?.origin, { field: 'origin' });
    if (rawOrigin && rawOrigin !== 'threadshelf' && rawOrigin !== 'archive') {
      throw new ValidationError('Invalid origin: expected threadshelf or archive', {
        field: 'origin',
      });
    }
    origin = rawOrigin as 'threadshelf' | 'archive' | undefined;
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ error: e.message, field: e.field });
    }
    throw e;
  }

  try {
    const results = await searchAcrossCollections(q, collection, {
      n,
      roles: roles ?? undefined,
      keywordBoost,
      model,
      from,
      to,
      mode,
      origin,
    });
    res.json({ results });
  } catch (e) {
    console.error('[/api/search]', e);
    res.status(500).json({ error: (e as Error).message, results: [] });
  }
});

export default router;
