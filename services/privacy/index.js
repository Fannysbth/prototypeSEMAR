// PRIVACY SERVICE - satu-satunya layanan yang menerima data pribadi mentah dan menyimpan vault identitas.
import { z } from 'zod';
import { getConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createStore } from '../../shared/store.js';
import { asyncHandler, createBaseApp, createTap, errorHandler, mountTap, notFound, requireInternalKey, serve } from '../../shared/http.js';
import { createPrivacyCore } from './core.js';
import { POLICY } from './policy.js';

const config = getConfig();
const logger = createLogger('privacy', config.logLevel, config.isProd);
const store = await createStore({ driver: config.store.driver, namespace: 'privacy', dataDir: config.store.dataDir, databaseUrl: config.store.databaseUrl, logger });
const mappings = await store.collection('mappings', { indexes: ['subject_ref', 'group_ref'] });
const meta = await store.collection('meta');
// Audit berantai hash: tabel audit.audit_log dibuat migrasi dan hanya bisa INSERT/SELECT dari peran layanan.
const audit = await store.collection('audit', store.driver === 'postgres' ? { schema: 'audit', table: 'audit_log', managed: true, appendOnly: true } : { indexes: ['action', 'actor'], numericIndexes: ['ts_ms'] });
const core = createPrivacyCore({ mappings, audit, meta, config, policy: POLICY });

const app = createBaseApp({ service: 'privacy', config });
const auth = requireInternalKey(config);
const tap = createTap(config);
mountTap(app, tap, config, auth);

// Hanya di DEMO_MODE: geser jam untuk membuktikan kedaluwarsa token tanpa menunggu 30 hari.
const nowOf = (req) => {
  const off = config.demoMode ? Number(req.headers['x-demo-clock-offset-s']) : 0;
  return Date.now() + (Number.isFinite(off) ? off * 1000 : 0);
};

const scalar = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
const minimizeSchema = z.object({
  service: z.string().min(2).max(40),
  record: z.record(z.string().max(60), scalar),
  actor: z.string().max(60).optional(),
});
const reidentifySchema = z.object({
  pseudonym: z.string().regex(/^PSE_[A-Z]{3}_[0-9A-F]{20}$/, 'format pseudonim tidak valid'),
  requesting_service: z.string().min(2).max(40),
  purpose: z.string().min(2).max(40),
  actor: z.object({ id: z.string().min(1).max(60), role: z.string().min(1).max(30) }),
  case_id: z.string().min(3).max(80),
  justification: z.string().trim().min(20, 'alasan minimal 20 karakter').max(500),
});
const revokeSchema = z.object({ subject_id: z.string().min(3).max(64).optional(), pseudonym: z.string().regex(/^PSE_[A-Z]{3}_[0-9A-F]{20}$/).optional(), actor: z.object({ id: z.string().min(1).max(60) }) })
  .refine((v) => v.subject_id || v.pseudonym, 'subject_id atau pseudonym wajib');
const eventSchema = z.object({
  action: z.enum(['CASE_STATUS', 'THRESHOLD_CHANGE', 'FILE_REQUEST', 'FILE_REPLY', 'CASE_ESCALATE', 'LLM_PII_BLOCKED']), actor: z.string().min(1).max(60), role: z.string().max(30),
  target: z.string().max(80).optional(), reason: z.string().max(500).optional(),
});

app.post('/v1/minimize', auth, tap.middleware, asyncHandler(async (req, res) => {
  const { service, record, actor } = minimizeSchema.parse(req.body);
  res.json(await core.minimize({ service, record, actor, now: nowOf(req) }));
}));

app.post('/v1/reidentify', auth, asyncHandler(async (req, res) => {
  res.json(await core.reidentify({ ...reidentifySchema.parse(req.body), now: nowOf(req) }));
}));

app.post('/v1/revoke', auth, asyncHandler(async (req, res) => {
  res.json(await core.revokeSubject({ ...revokeSchema.parse(req.body), now: nowOf(req) }));
}));

app.post('/v1/audit/event', auth, asyncHandler(async (req, res) => { await core.recordEvent(eventSchema.parse(req.body)); res.status(201).json({ recorded: true }); }));
app.post('/v1/keys/rotate', auth, asyncHandler(async (req, res) => res.json(await core.rotateKeys({ actor: z.object({ id: z.string().min(1).max(60) }).parse(req.body.actor), now: nowOf(req) }))));
app.post('/v1/screen', auth, asyncHandler(async (req, res) => res.json(await core.screenText(z.object({ text: z.string().max(20000) }).parse(req.body).text))));
app.get('/v1/audit/verify', auth, asyncHandler(async (req, res) => res.json(await core.verifyAudit())));
app.get('/v1/audit', auth, asyncHandler(async (req, res) => {
  res.json({ items: await core.listAudit(Math.min(Number(req.query.limit) || 100, 500)) });
}));
app.get('/v1/stats', auth, asyncHandler(async (req, res) => res.json(await core.stats())));
app.get('/v1/policy', auth, (req, res) => res.json(core.policyView()));

app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.internalHost, port: config.ports.privacy, logger, onShutdown: () => store.close() });
