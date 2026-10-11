// API GATEWAY - satu-satunya pintu masuk dari luar. Juga menyajikan UI web (folder public/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getConfig, ROOT } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { FACILITIES, REFERENCE } from '../../shared/reference.js';
import { asyncHandler, createBaseApp, errorHandler, HttpError, notFound, serve } from '../../shared/http.js';
import { createClients } from './clients.js';
import { createPipeline, ensureMode } from './pipeline.js';
import { buildClaimSchema, loginSchema, reviewSchema, revealSchema, revokeSchema } from './schemas.js';
import { runScenario, scenarioList } from './simulate.js';

const config = getConfig();
const logger = createLogger('gateway', config.logLevel, config.isProd);
const clients = createClients(config);
const pipeline = createPipeline({ config, clients, logger });
const claimSchema = buildClaimSchema({ syntheticOnly: config.syntheticOnly });
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const app = createBaseApp({ service: 'gateway', config });
app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'connect-src': ["'self'", ...(config.allowedOrigin ? config.allowedOrigin.split(',') : [])], 'upgrade-insecure-requests': config.isProd ? [] : null } },
  crossOriginResourcePolicy: { policy: config.allowedOrigin ? 'cross-origin' : 'same-origin' },
}));
if (config.allowedOrigin) app.use(cors({ origin: config.allowedOrigin.split(','), methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['content-type', 'authorization', 'idempotency-key'] }));

const tooMany = (msg) => (req, res, next) => next(new HttpError(429, 'TOO_MANY_REQUESTS', msg));
app.use('/api', rateLimit({ windowMs: 60000, limit: config.rateLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Terlalu banyak permintaan, coba lagi sebentar') }));
// Hanya login GAGAL yang dihitung -> perlindungan brute-force tanpa mengganggu pengguna sah.
const loginLimiter = rateLimit({ windowMs: 60000, limit: config.loginMaxFailsPerMin, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Terlalu banyak percobaan login gagal, coba lagi satu menit lagi') });

function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Login diperlukan'));
  try {
    req.user = jwt.verify(token, config.secrets.JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch { return next(new HttpError(401, 'INVALID_TOKEN', 'Token tidak valid atau kedaluwarsa')); }
}
const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : next(new HttpError(403, 'FORBIDDEN', 'Peran Anda tidak diizinkan untuk aksi ini')));
const demoOnly = (req, res, next) => (config.demoMode ? next() : next(new HttpError(404, 'NOT_FOUND', 'Endpoint demo nonaktif')));

// ---------- publik ----------
app.get('/api/config', (req, res) => res.json({
  demo_mode: config.demoMode, synthetic_only: config.syntheticOnly, default_mode: config.defaultMode, allow_baseline: config.allowBaseline,
  store: config.store.driver, facilities: FACILITIES,
  diagnoses: Object.entries(REFERENCE).map(([code, r]) => ({ code, name: r.name, procedures: r.procedures, expected_los: r.expected_los, tariff_median: r.tariff_median })), scenarios: config.demoMode ? scenarioList() : [],
}));
app.get('/api/ready', asyncHandler(async (req, res) => {
  const names = ['auth', 'privacy', 'claims', 'fraud', 'notify'];
  const status = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await clients.health(n)])));
  res.status(Object.values(status).every(Boolean) ? 200 : 503).json({ ready: Object.values(status).every(Boolean), services: status });
}));
app.post('/api/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  res.json(await clients.auth.login(loginSchema.parse(req.body), req.id));
}));
app.get('/api/auth/demo-users', demoOnly, asyncHandler(async (req, res) => res.json(await clients.auth.demoUsers())));

// ---------- klaim (peran: facility) ----------
app.post('/api/claims', authenticate, requireRole('facility'), asyncHandler(async (req, res) => {
  const mode = ensureMode(config, req.query.mode);
  const claim = claimSchema.parse(req.body);
  const idem = req.headers['idempotency-key'];
  if (idem !== undefined && !/^[A-Za-z0-9_\-]{8,64}$/.test(String(idem))) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key 8-64 karakter alfanumerik');
  res.status(201).json(await pipeline.submitClaim({ claim, facility_id: req.user.facility_id, mode, actor: req.user, idempotencyKey: idem ? String(idem) : undefined, requestId: req.id }));
}));
app.get('/api/claims', authenticate, requireRole('facility', 'verifier'), asyncHandler(async (req, res) => {
  const q = req.user.role === 'facility' ? `?facility_id=${encodeURIComponent(req.user.facility_id)}&limit=50` : '?limit=50';
  res.json(await clients.claims.list(q));
}));

// ---------- verifikator: kasus, review, buka identitas ----------
app.get('/api/cases', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => {
  const status = req.query.status && /^[A-Z_]+$/.test(String(req.query.status)) ? `?status=${req.query.status}` : '';
  res.json(await clients.fraud.cases(status));
}));
app.get('/api/cases/:id', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => res.json(await clients.fraud.getCase(req.params.id))));
app.post('/api/cases/:id/review', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => {
  const body = reviewSchema.parse(req.body);
  res.json(await clients.fraud.review(req.params.id, { ...body, reviewer: req.user.sub }));
}));
app.post('/api/cases/:id/reveal', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => {
  const { justification } = revealSchema.parse(req.body);
  const c = await clients.fraud.getCase(req.params.id);
  if (!/^PSE_FRD_/.test(c.fraud_ref)) {
    // Mode baseline: tidak ada token, identitas sudah terbuka di layanan fraud sejak awal.
    return res.json({ case_id: c.case_id, patient_nik: c.fraud_ref, protected: false, note: 'Mode baseline: identitas sudah terbuka di Fraud Service tanpa kontrol & audit.' });
  }
  const r = await clients.privacy.reidentify({
    pseudonym: c.fraud_ref, requesting_service: 'FRAUD_DETECTION', purpose: 'CROSS_FACILITY_MATCHING',
    actor: { id: req.user.sub, role: req.user.role }, case_id: c.case_id, justification,
  }, req.id);
  return res.json({ case_id: c.case_id, patient_nik: r.subject_id, protected: true, note: 'Pembukaan identitas ini tercatat di audit log.' });
}));
app.post('/api/subjects/revoke', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => {
  const { patient_nik } = revokeSchema.parse(req.body);
  res.json(await clients.privacy.revoke({ subject_id: patient_nik, actor: { id: req.user.sub } }, req.id));
}));

app.get('/api/stats', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => {
  const [claims, fraud, privacy] = await Promise.all([clients.claims.stats(), clients.fraud.stats(), clients.privacy.stats()]);
  res.json({ claims, fraud, privacy });
}));
app.get('/api/audit', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => res.json(await clients.privacy.audit(Math.min(Number(req.query.limit) || 100, 300)))));
app.get('/api/policy', authenticate, asyncHandler(async (req, res) => res.json(await clients.privacy.policy())));
app.get('/api/notifications', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => res.json(await clients.notify.list())));

app.get('/api/evaluation/latest', authenticate, (req, res) => {
  const file = path.join(ROOT, 'reports', 'evaluation.json');
  if (!fs.existsSync(file)) throw new HttpError(404, 'NO_REPORT', 'Belum ada laporan evaluasi. Jalankan: npm run evaluate');
  res.type('application/json').send(fs.readFileSync(file, 'utf8'));
});

// ---------- demo ----------
app.get('/api/demo/tap/:service', demoOnly, authenticate, asyncHandler(async (req, res) => {
  if (!['claims', 'fraud', 'notify'].includes(req.params.service)) throw new HttpError(404, 'NOT_FOUND', 'Layanan tidak tersedia untuk inspeksi');
  res.json(await clients.tap(req.params.service));
}));
app.delete('/api/demo/tap', demoOnly, authenticate, asyncHandler(async (req, res) => {
  await Promise.all(['claims', 'fraud', 'notify'].map((s) => clients.clearTap(s)));
  res.json({ cleared: true });
}));
app.post('/api/demo/simulate/:scenario', demoOnly, authenticate, requireRole('facility', 'verifier'), asyncHandler(async (req, res) => {
  const mode = ensureMode(config, req.query.mode);
  res.json(await runScenario({ name: req.params.scenario, mode, pipeline, actor: req.user, requestId: req.id }));
}));

app.use('/api', notFound);
app.use(express.static(publicDir, { maxAge: 0, etag: true }));
app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.host, port: config.ports.gateway, logger });
