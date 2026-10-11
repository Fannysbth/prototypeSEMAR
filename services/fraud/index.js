// FRAUD DETECTION SERVICE - hanya melihat token pasien (fraud_ref) + atribut klinis/klaim.
import { z } from 'zod';
import { getConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createStore } from '../../shared/store.js';
import { asyncHandler, createBaseApp, createTap, errorHandler, HttpError, mountTap, notFound, requireInternalKey, serve } from '../../shared/http.js';
import { createEngine, trainForest } from './engine.js';

const config = getConfig();
const logger = createLogger('fraud', config.logLevel, config.isProd);
const store = await createStore({ driver: config.store.driver, namespace: 'fraud', dataDir: config.store.dataDir, databaseUrl: config.store.databaseUrl, logger });
const observations = await store.collection('observations', { indexes: ['fraud_ref', 'fingerprint'], numericIndexes: ['admit_ms'] });
const cases = await store.collection('cases', { indexes: ['status'], numericIndexes: ['created_ms'] });

// Model dilatih saat start pada klaim NORMAL sintetis (memori). Ganti dengan data historis ber-token di produksi.
const scratch = await createStore({ driver: 'memory', namespace: 'train' });
const t0 = Date.now();
const forest = await trainForest({ createMemoryCollection: () => scratch.collection('obs') });
logger.info(`Isolation Forest siap (${Date.now() - t0} ms)`);
const engine = createEngine({ observations, cases, forest });

const app = createBaseApp({ service: 'fraud', config });
const auth = requireInternalKey(config);
const tap = createTap(config);
mountTap(app, tap, config, auth);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// passthrough: di mode baseline Gateway mengirim payload mentah; service ini hanya memakai field yang ia butuhkan
// dan TIDAK menyimpan sisanya.
const analyzeSchema = z.object({
  claim_id: z.string().min(3).max(64), facility_id: z.string().min(2).max(20),
  fraud_ref: z.string().min(8).max(64),
  diagnosis_code: z.string().min(2).max(10), procedure_code: z.string().max(10).nullish(),
  claim_type: z.enum(['RI', 'RJ']).default('RI'), admit_date: isoDate,
  length_of_stay: z.number().int().min(1).max(365), amount: z.number().positive(),
}).passthrough();
const reviewSchema = z.object({
  decision: z.enum(['CONFIRMED_FRAUD', 'DISMISSED_FALSE_POSITIVE', 'NEEDS_MORE_INFO']),
  note: z.string().trim().min(3).max(500), reviewer: z.string().min(1).max(60),
});

app.post('/v1/analyze', auth, tap.middleware, asyncHandler(async (req, res) => {
  res.json(await engine.analyze(analyzeSchema.parse(req.body)));
}));

app.get('/v1/cases', auth, asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  res.json({ items: await cases.find(status ? { eq: { status } } : {}, { orderBy: 'created_ms', dir: 'desc', limit: Math.min(Number(req.query.limit) || 100, 300) }) });
}));
app.get('/v1/cases/:id', auth, asyncHandler(async (req, res) => {
  const c = await cases.get(req.params.id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Kasus tidak ditemukan');
  res.json(c);
}));
app.post('/v1/cases/:id/review', auth, asyncHandler(async (req, res) => {
  const updated = await engine.review(req.params.id, reviewSchema.parse(req.body));
  if (!updated) throw new HttpError(404, 'NOT_FOUND', 'Kasus tidak ditemukan');
  res.json(updated);
}));
app.get('/v1/stats', auth, asyncHandler(async (req, res) => res.json(await engine.stats())));

app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.internalHost, port: config.ports.fraud, logger, onShutdown: async () => { await store.close(); } });
