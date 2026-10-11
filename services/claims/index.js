// CLAIM PROCESSING SERVICE - menyimpan klaim apa adanya.
// Layanan ini TIDAK tahu apakah patient_token yang diterimanya token atau NIK asli: kodenya sama persis
// di mode baseline maupun proposed. Yang berbeda hanya isi payload yang dikirim Gateway.
import { z } from 'zod';
import { getConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createStore } from '../../shared/store.js';
import { asyncHandler, createBaseApp, createTap, errorHandler, HttpError, mountTap, notFound, requireInternalKey, serve } from '../../shared/http.js';

const config = getConfig();
const logger = createLogger('claims', config.logLevel, config.isProd);
const store = await createStore({ driver: config.store.driver, namespace: 'claims', dataDir: config.store.dataDir, databaseUrl: config.store.databaseUrl, logger });
const claims = await store.collection('claims', { indexes: ['facility_id'], numericIndexes: ['created_ms'] });

const app = createBaseApp({ service: 'claims', config });
const auth = requireInternalKey(config);
const tap = createTap(config);
mountTap(app, tap, config, auth);

const scalar = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
const claimSchema = z.object({
  claim_id: z.string().min(3).max(64),
  facility_id: z.string().min(2).max(20),
  amount: z.number().positive(),
  meta: z.object({ mode: z.string().max(20), submitted_by: z.string().max(60) }).optional(),
}).catchall(scalar);

app.post('/v1/claims', auth, tap.middleware, asyncHandler(async (req, res) => {
  const doc = claimSchema.parse(req.body);
  const created_ms = Date.now();
  const ok = await claims.insertIfAbsent(doc.claim_id, { ...doc, created_ms });
  if (!ok) throw new HttpError(409, 'DUPLICATE_CLAIM', 'Klaim dengan ID/Idempotency-Key yang sama sudah pernah diterima');
  res.status(201).json({ claim_id: doc.claim_id, created_ms });
}));

app.get('/v1/claims', auth, asyncHandler(async (req, res) => {
  const eq = req.query.facility_id ? { facility_id: String(req.query.facility_id) } : {};
  res.json({ items: await claims.find({ eq }, { orderBy: 'created_ms', dir: 'desc', limit: Math.min(Number(req.query.limit) || 50, 200) }) });
}));
app.get('/v1/claims/:id', auth, asyncHandler(async (req, res) => {
  const c = await claims.get(req.params.id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Klaim tidak ditemukan');
  res.json(c);
}));
app.get('/v1/stats', auth, asyncHandler(async (req, res) => res.json({ total: await claims.count({}) })));

app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.internalHost, port: config.ports.claims, logger, onShutdown: () => store.close() });
