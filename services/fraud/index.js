// FRAUD DETECTION SERVICE - hanya melihat token pasien (fraud_ref) + atribut klinis/klaim.
import { z } from 'zod';
import { getConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createStore } from '../../shared/store.js';
import { asyncHandler, createBaseApp, createTap, errorHandler, HttpError, mountTap, notFound, requireInternalKey, serve } from '../../shared/http.js';
import { CASE_STATUSES, createEngine } from './engine.js';
import { createMlClient } from './ml-client.js';

const config = getConfig();
const logger = createLogger('fraud', config.logLevel, config.isProd);
const store = await createStore({ driver: config.store.driver, namespace: 'fraud', dataDir: config.store.dataDir, databaseUrl: config.store.databaseUrl, logger });
const observations = await store.collection('observations', { indexes: ['fraud_ref', 'fingerprint'], numericIndexes: ['admit_ms'] });
const cases = await store.collection('cases', { indexes: ['status', 'risk_level'], numericIndexes: ['created_ms'] });
const events = await store.collection('case_events', { indexes: ['case_id'], numericIndexes: ['at_ms'] });
const settings = await store.collection('settings');
const engine = createEngine({ observations, cases, events, settings, ml: config.mlEnabled ? createMlClient(config) : undefined });

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
const statusSchema = z.object({ status: z.enum(CASE_STATUSES), note: z.string().trim().max(500).optional(), actor: z.string().min(1).max(60) });
const explanationSchema = z.object({ text: z.string().min(10).max(3000), source: z.enum(['llm', 'template']) });
const thresholdSchema = z.object({ case_score: z.number().int() });
const listSchema = z.object({
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(), modus: z.string().regex(/^[A-Z_]+$/).optional(), status: z.enum(CASE_STATUSES).optional(),
  faskes: z.string().max(20).optional(), from: isoDate.optional(), to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(2000).optional(),
});
const found = (c) => { if (!c) throw new HttpError(404, 'NOT_FOUND', 'Kasus tidak ditemukan'); return c; };

app.post('/v1/analyze', auth, tap.middleware, asyncHandler(async (req, res) => {
  res.json(await engine.analyze(analyzeSchema.parse(req.body)));
}));

app.get('/v1/cases', auth, asyncHandler(async (req, res) => res.json({ items: await engine.listCases(listSchema.parse(req.query)) })));
app.get('/v1/cases/:id', auth, asyncHandler(async (req, res) => res.json(found(await engine.getCase(req.params.id)))));
app.patch('/v1/cases/:id', auth, asyncHandler(async (req, res) => res.json(found(await engine.setStatus(req.params.id, statusSchema.parse(req.body))))));
app.post('/v1/cases/:id/review', auth, asyncHandler(async (req, res) => res.json(found(await engine.review(req.params.id, reviewSchema.parse(req.body))))));
app.post('/v1/cases/:id/explanation', auth, asyncHandler(async (req, res) => {
  const { text, source } = explanationSchema.parse(req.body);
  found(await cases.get(req.params.id));
  res.json(await cases.update(req.params.id, { explanation: text, explanation_source: source, explained_ms: Date.now() }));
}));

app.get('/v1/thresholds', auth, (req, res) => res.json(engine.getThresholds()));
app.put('/v1/thresholds', auth, asyncHandler(async (req, res) => res.json(await engine.setThresholds(thresholdSchema.parse(req.body)))));
app.get('/v1/scores', auth, asyncHandler(async (req, res) => {
  const rows = await observations.find({}, { orderBy: 'created_ms', dir: 'desc', limit: Math.min(Number(req.query.limit) || 20000, 50000) });
  res.json({ items: rows.filter((o) => o.result).map((o) => ({ claim_id: o.claim_id, fraud_ref: o.fraud_ref, facility_id: o.facility_id, claim_type: o.claim_type, diagnosis_code: o.diagnosis_code, amount: o.amount, admit_date: o.admit_date, score: o.result.risk_score, risk_level: o.result.risk_level, case_id: o.result.case_id })) });
}));
app.get('/v1/events', auth, asyncHandler(async (req, res) => res.json({ items: await events.find({}, { orderBy: 'at_ms', dir: 'desc', limit: Math.min(Number(req.query.limit) || 20, 100) }) })));
app.get('/v1/stats', auth, asyncHandler(async (req, res) => res.json(await engine.stats())));

app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.internalHost, port: config.ports.fraud, logger, onShutdown: async () => { await store.close(); } });
