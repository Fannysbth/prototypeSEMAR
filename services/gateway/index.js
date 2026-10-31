// API GATEWAY - satu-satunya pintu masuk dari luar. Juga menyajikan UI web (folder web/) dan Swagger di /docs.
// Semua path /api/v1/* sama dengan /api/* (spesifikasi memakai /api/v1).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getConfig, ROOT } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createStore } from '../../shared/store.js';
import { parseCsv, toCsv } from '../../shared/csv.js';
import { zipFiles } from '../../shared/zip.js';
import { FACILITIES, REFERENCE } from '../../shared/reference.js';
import { asyncHandler, createBaseApp, errorHandler, HttpError, notFound, serve } from '../../shared/http.js';
import { createClients } from './clients.js';
import { createPipeline, ensureMode } from './pipeline.js';
import { buildClaimSchema, caseQuerySchema, loginSchema, reviewSchema, revealSchema, revokeSchema, statusSchema, thresholdSchema } from './schemas.js';
import { runScenario, scenarioList } from './simulate.js';
import { createUploader, viewBatch } from './upload.js';
import { buildKaggleClaimSchema } from './kaggle-adapter.js';
import { createExplainer } from './explain.js';
import { createWorkflow, REPLY_PATH } from './workflow.js';
import { createHome } from './home.js';
import { impactSchema, impactScenarios, simulateImpact } from './impact.js';
import { buildVerifySchema, toPipelineClaim, toVerifyResponse } from './verify.js';

const config = getConfig();
const logger = createLogger('gateway', config.logLevel, config.isProd);
const clients = createClients(config);
const pipeline = createPipeline({ config, clients, logger });
const store = await createStore({ driver: config.store.driver, namespace: 'gateway', dataDir: config.store.dataDir, databaseUrl: config.store.databaseUrl, logger });
const claimSchema = buildClaimSchema({ syntheticOnly: config.syntheticOnly });
const verifySchema = buildVerifySchema({ syntheticOnly: config.syntheticOnly });
const uploader = createUploader({ claimSchema, kaggleSchema: buildKaggleClaimSchema({ syntheticOnly: config.syntheticOnly }), pipeline, batches: await store.collection('batches', { indexes: ['uploaded_by'], numericIndexes: ['created_ms'] }), mode: 'proposed' });
const workflow = createWorkflow({ clients, requests: await store.collection('file_requests', { indexes: ['facility_id', 'case_id'], numericIndexes: ['created_ms'] }) });
const explainer = createExplainer({ llm: config.llm, screen: (text) => clients.privacy.screen(text) });
const webDir = path.join(ROOT, 'web');
const swaggerDir = path.dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));

const app = createBaseApp({ service: 'gateway', config, bigJson: [{ test: REPLY_PATH, limit: '300kb' }] });
app.use((req, res, next) => { if (req.url.startsWith('/api/v1/')) req.url = req.url.replace('/api/v1/', '/api/'); next(); });
app.use(helmet({
  contentSecurityPolicy: { useDefaults: true, directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'connect-src': ["'self'", ...(config.allowedOrigin ? config.allowedOrigin.split(',') : [])], 'upgrade-insecure-requests': config.isProd ? [] : null } },
  crossOriginResourcePolicy: { policy: config.allowedOrigin ? 'cross-origin' : 'same-origin' },
}));
if (config.allowedOrigin) app.use(cors({ origin: config.allowedOrigin.split(','), methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], allowedHeaders: ['content-type', 'authorization', 'idempotency-key'] }));

const tooMany = (msg) => (req, res, next) => next(new HttpError(429, 'TOO_MANY_REQUESTS', msg));
app.use('/api', rateLimit({ windowMs: 60000, limit: config.rateLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Terlalu banyak permintaan, coba lagi sebentar') }));
// Hanya login GAGAL yang dihitung -> perlindungan brute-force tanpa mengganggu pengguna sah.
const loginLimiter = rateLimit({ windowMs: 60000, limit: config.loginMaxFailsPerMin, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Terlalu banyak percobaan login gagal, coba lagi satu menit lagi') });
const verifyLimiter = rateLimit({ windowMs: 60000, limit: config.verifyRateLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Terlalu banyak permintaan /verify, coba lagi sebentar') });

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
const actorOf = (req) => ({ id: req.user.sub, role: req.user.role });
const qs = (obj) => { const q = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined)).toString(); return q ? `?${q}` : ''; };
const FACILITY_ROLES = ['facility', 'verifier'];
const REVIEWERS = ['verifier', 'auditor'];

// ---------- publik ----------
app.get('/api/config', (req, res) => res.json({
  demo_mode: config.demoMode, synthetic_only: config.syntheticOnly, default_mode: config.defaultMode, allow_baseline: config.allowBaseline,
  store: config.store.driver, facilities: FACILITIES,
  diagnoses: Object.entries(REFERENCE).map(([code, r]) => ({ code, name: r.name, procedures: r.procedures, expected_los: r.expected_los, tariff_median: r.tariff_median })), scenarios: config.demoMode ? scenarioList() : [],
}));
const serviceStatus = async () => {
  const names = ['auth', 'privacy', 'claims', 'fraud', 'notify'];
  return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await clients.health(n)])));
};
const home = createHome({ clients, uploader, workflow, config, serviceStatus });
app.get('/api/ready', asyncHandler(async (req, res) => {
  const status = await serviceStatus();
  res.status(Object.values(status).every(Boolean) ? 200 : 503).json({ ready: Object.values(status).every(Boolean), services: status });
}));
app.get('/api/health', asyncHandler(async (req, res) => {
  const [services, model] = await Promise.all([serviceStatus(), clients.mlModel()]);
  res.json({ ok: Object.values(services).every(Boolean), services, ml: { available: !!model, version: model?.version ?? null } });
}));
app.post('/api/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  res.json(await clients.auth.login(loginSchema.parse(req.body), req.id));
}));
app.get('/api/auth/demo-users', demoOnly, asyncHandler(async (req, res) => res.json(await clients.auth.demoUsers())));
app.get('/api/me', authenticate, (req, res) => res.json({ username: req.user.sub, role: req.user.role, facility_id: req.user.facility_id, name: req.user.name }));

// ---------- klaim ----------
app.post('/api/claims', authenticate, requireRole('facility'), asyncHandler(async (req, res) => {
  const mode = ensureMode(config, req.query.mode);
  const claim = claimSchema.parse(req.body);
  const idem = req.headers['idempotency-key'];
  if (idem !== undefined && !/^[A-Za-z0-9_\-]{8,64}$/.test(String(idem))) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key 8-64 karakter alfanumerik');
  res.status(201).json(await pipeline.submitClaim({ claim, facility_id: req.user.facility_id, mode, actor: req.user, idempotencyKey: idem ? String(idem) : undefined, requestId: req.id }));
}));
app.post('/api/claims/upload', authenticate, requireRole(...FACILITY_ROLES), express.text({ type: 'text/csv', limit: '20mb' }), asyncHandler(async (req, res) => {
  if (typeof req.body !== 'string') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Kirim CSV dengan Content-Type: text/csv');
  const asyncMode = req.query.async === 'true';
  const batch = await uploader.upload({ csv: req.body, user: req.user, requestId: req.id, async: asyncMode, source: req.query.source });
  res.status(asyncMode ? 202 : 200).json(viewBatch(batch, req.user.role));
}));
app.get('/api/claims/batches/:id', authenticate, requireRole(...FACILITY_ROLES), asyncHandler(async (req, res) => {
  const b = await uploader.get(req.params.id);
  if (!b || b.uploaded_by !== req.user.sub) throw new HttpError(404, 'NOT_FOUND', 'Batch tidak ditemukan');
  res.json(viewBatch(b, req.user.role));
}));
app.get('/api/claims', authenticate, requireRole(...FACILITY_ROLES), asyncHandler(async (req, res) => {
  const q = req.user.role === 'facility' ? `?facility_id=${encodeURIComponent(req.user.facility_id)}&limit=50` : '?limit=50';
  res.json(await clients.claims.list(q));
}));

// ---------- beranda per peran dan daftar klaim ter-token ----------
app.get('/api/home', authenticate, asyncHandler(async (req, res) => res.json(await home.build(req.user))));
app.get('/api/claims/tokenized', authenticate, requireRole('verifier', 'auditor', 'admin'), asyncHandler(async (req, res) => res.json(await home.tokenized(req.query))));

// ---------- /verify: skor satu klaim secara sinkron ----------
app.post('/api/verify', verifyLimiter, authenticate, requireRole('verifier', 'admin'), asyncHandler(async (req, res) => {
  const t0 = performance.now();
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, 'VALIDATION_ERROR', 'Validasi gagal', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const v = parsed.data;
  const r = await pipeline.submitClaim({ claim: toPipelineClaim(v), facility_id: v.facility_id, mode: 'proposed', actor: req.user, requestId: req.id, claimId: v.claim_id, allowDuplicate: true });
  res.json(toVerifyResponse(v, r, performance.now() - t0));
}));

// ---------- kasus ----------
app.get('/api/cases', authenticate, requireRole(...REVIEWERS), asyncHandler(async (req, res) => {
  res.json(await clients.fraud.cases(qs(caseQuerySchema.parse(req.query))));
}));
app.get('/api/cases/:id', authenticate, requireRole(...REVIEWERS), asyncHandler(async (req, res) => res.json(await clients.fraud.getCase(req.params.id))));
app.patch('/api/cases/:id', authenticate, requireRole(...REVIEWERS), asyncHandler(async (req, res) => {
  const body = statusSchema.parse(req.body);
  const before = await clients.fraud.getCase(req.params.id);
  const updated = await clients.fraud.setStatus(req.params.id, { ...body, actor: req.user.sub });
  await clients.privacy.event({ action: 'CASE_STATUS', actor: req.user.sub, role: req.user.role, target: req.params.id, reason: `${before.status} -> ${body.status}${body.note ? `: ${body.note}` : ''}`.slice(0, 500) }, req.id);
  res.json(updated);
}));
app.post('/api/cases/:id/review', authenticate, requireRole(...REVIEWERS), asyncHandler(async (req, res) => {
  const body = reviewSchema.parse(req.body);
  const before = await clients.fraud.getCase(req.params.id);
  const updated = await clients.fraud.review(req.params.id, { ...body, reviewer: req.user.sub });
  await clients.privacy.event({ action: 'CASE_STATUS', actor: req.user.sub, role: req.user.role, target: req.params.id, reason: `${before.status} -> ${updated.status}: ${body.note}`.slice(0, 500) }, req.id);
  res.json(updated);
}));
app.post('/api/cases/:id/explain', authenticate, requireRole(...REVIEWERS), asyncHandler(async (req, res) => {
  const c = await clients.fraud.getCase(req.params.id);
  const r = await explainer.explain(c);
  await clients.fraud.setExplanation(c.case_id, { text: r.text, source: r.source });
  if (r.pii_blocked) await clients.privacy.event({ action: 'LLM_PII_BLOCKED', actor: req.user.sub, role: req.user.role, target: c.case_id, reason: String(r.note).slice(0, 200) }, req.id);
  res.json({ case_id: c.case_id, explanation: r.text, explanation_source: r.source, ...(r.note ? { note: r.note } : {}) });
}));
// ---------- alur tanpa membuka identitas: minta berkas ke faskes, balasan faskes, eskalasi ----------
app.post('/api/cases/:id/request-file', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => res.status(201).json(await workflow.requestFile({ caseId: req.params.id, body: req.body, user: req.user, requestId: req.id }))));
app.post('/api/cases/:id/escalate', authenticate, requireRole('verifier'), asyncHandler(async (req, res) => res.json(await workflow.escalate({ caseId: req.params.id, body: req.body, user: req.user, requestId: req.id }))));
app.get('/api/file-requests', authenticate, requireRole('facility', 'verifier', 'auditor'), asyncHandler(async (req, res) => res.json({ items: await workflow.list({ user: req.user, caseId: req.query.case_id ? String(req.query.case_id) : undefined }) })));
app.post('/api/file-requests/:id/reply', authenticate, requireRole('facility'), asyncHandler(async (req, res) => res.json(await workflow.reply({ id: req.params.id, body: req.body, user: req.user, requestId: req.id }))));
app.get('/api/file-requests/:id/attachment', authenticate, requireRole('auditor'), asyncHandler(async (req, res) => {
  const a = await workflow.attachment(req.params.id);
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('Content-Disposition', `attachment; filename="${a.name.replace(/[^\w.\- ]/g, '_')}"`);
  res.type('application/octet-stream').send(a.bytes);
}));
app.post('/api/cases/:id/reveal', authenticate, requireRole('auditor'), asyncHandler(async (req, res) => {
  const { justification } = revealSchema.parse(req.body);
  const c = await clients.fraud.getCase(req.params.id);
  if (!/^PSE_FRD_/.test(c.fraud_ref)) {
    // Mode baseline: tidak ada token, identitas sudah terbuka di layanan fraud sejak awal.
    return res.json({ case_id: c.case_id, patient_nik: c.fraud_ref, protected: false, note: 'Mode baseline: identitas sudah terbuka di Fraud Service tanpa kontrol & audit.' });
  }
  const r = await clients.privacy.reidentify({
    pseudonym: c.fraud_ref, requesting_service: 'FRAUD_DETECTION', purpose: 'CROSS_FACILITY_MATCHING',
    actor: actorOf(req), case_id: c.case_id, justification,
  }, req.id);
  return res.json({ case_id: c.case_id, patient_nik: r.subject_id, protected: true, note: 'Pembukaan identitas ini tercatat di audit log.' });
}));

// ---------- admin: revoke, rotasi kunci, ambang, audit ----------
async function revoke(req, res) {
  const body = revokeSchema.parse(req.body);
  res.json(await clients.privacy.revoke({ ...(body.subject_token ? { pseudonym: body.subject_token } : { subject_id: body.patient_nik }), actor: { id: req.user.sub } }, req.id));
}
app.post('/api/tokens/revoke', authenticate, requireRole('admin'), asyncHandler(revoke));
app.post('/api/subjects/revoke', authenticate, requireRole('admin'), asyncHandler(revoke));
app.post('/api/keys/rotate', authenticate, requireRole('admin'), asyncHandler(async (req, res) => res.json(await clients.privacy.rotate({ actor: { id: req.user.sub } }, req.id))));
app.get('/api/settings/threshold', authenticate, requireRole('verifier', 'auditor', 'admin'), asyncHandler(async (req, res) => res.json(await clients.fraud.thresholds())));
app.put('/api/settings/threshold', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const before = await clients.fraud.thresholds();
  const after = await clients.fraud.setThresholds(thresholdSchema.parse(req.body));
  await clients.privacy.event({ action: 'THRESHOLD_CHANGE', actor: req.user.sub, role: req.user.role, target: 'case_score', reason: `${before.case_score} -> ${after.case_score}` }, req.id);
  res.json(after);
}));
app.get('/api/audit', authenticate, requireRole('admin'), asyncHandler(async (req, res) => res.json(await clients.privacy.audit(Math.min(Number(req.query.limit) || 100, 300)))));
app.get('/api/audit/verify', authenticate, requireRole('admin'), asyncHandler(async (req, res) => res.json(await clients.privacy.auditVerify())));

// ---------- dashboard, simulasi, ekspor ----------
app.get('/api/dashboard/summary', authenticate, requireRole('verifier', 'auditor', 'admin'), asyncHandler(async (req, res) => {
  const [claims, fraud, privacy] = await Promise.all([clients.claims.stats(), clients.fraud.stats(), clients.privacy.stats()]);
  res.json({
    claims_total: claims.total, cases_total: fraud.total_cases, cases_by_level: fraud.by_level, cases_by_modus: fraud.by_modus, cases_by_facility: fraud.by_facility,
    cases_by_status: fraud.by_status, potensi_nilai_dipertanyakan_total: fraud.potensi_nilai_dipertanyakan_total, review_precision: fraud.review_precision,
    tokens_active: privacy.tokens_active, tokens_revoked: privacy.tokens_revoked, reveal_success: privacy.reidentify_success, reveal_denied: privacy.reidentify_denied,
  });
}));
app.get('/api/stats', authenticate, requireRole('verifier', 'auditor', 'admin'), asyncHandler(async (req, res) => {
  const [claims, fraud, privacy] = await Promise.all([clients.claims.stats(), clients.fraud.stats(), clients.privacy.stats()]);
  res.json({ claims, fraud, privacy });
}));
app.post('/api/impact/simulate', authenticate, requireRole('auditor', 'admin'), (req, res) => res.json(simulateImpact(impactSchema.parse(req.body))));

const CASE_COLUMNS = ['case_id', 'claim_id', 'subject_token', 'facility_id', 'facilities', 'diagnosis_code', 'amount', 'risk_score', 'risk_level', 'modus', 'status', 'potensi_nilai_dipertanyakan', 'created'];
const caseRows = (items) => items.map((c) => ({
  case_id: c.case_id, claim_id: c.claim_id, subject_token: c.fraud_ref, facility_id: c.facility_id, facilities: c.facilities.join('|'), diagnosis_code: c.diagnosis_code,
  amount: c.amount, risk_score: c.risk_score, risk_level: c.risk_level, modus: c.modi.join('|'), status: c.status, potensi_nilai_dipertanyakan: c.potensi_nilai_dipertanyakan, created: new Date(c.created_ms).toISOString(),
}));
app.get('/api/reports/cases.csv', authenticate, requireRole('auditor'), asyncHandler(async (req, res) => {
  const { items } = await clients.fraud.cases('?limit=2000');
  res.type('text/csv').attachment('cases.csv').send(toCsv(caseRows(items), CASE_COLUMNS));
}));
app.get('/api/export/evalkit', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const [{ items: scores }, { items: cases }] = await Promise.all([clients.fraud.scores(), clients.fraud.cases('?limit=2000')]);
  const truthById = fs.existsSync(config.truthFile) ? new Map(parseCsv(fs.readFileSync(config.truthFile, 'utf8')).map((t) => [t.claim_ref, t])) : new Map();
  const truth = scores.filter((s) => truthById.has(s.claim_id)).map((s) => { const t = truthById.get(s.claim_id); return { entity_id: s.claim_id, label: t.label, modus: t.modus, excess_rupiah: t.excess_rupiah }; });
  const readme = truthById.size ? 'scores.csv dari sistem; truth.csv dari generator sintetis (label bukan hasil audit BPJS).\n' : 'truth.csv kosong: file label sintetis tidak ditemukan. Jalankan npm run demo:reset lalu unggah data/synthetic/claims.csv.\n';
  res.type('application/zip').attachment('evalkit.zip').send(zipFiles({
    'scores.csv': toCsv(scores.map((s) => ({ entity_id: s.claim_id, group_id: s.fraud_ref, score: s.score, stratum: s.claim_type })), ['entity_id', 'group_id', 'score', 'stratum']),
    'truth.csv': toCsv(truth, ['entity_id', 'label', 'modus', 'excess_rupiah']),
    'cases.csv': toCsv(caseRows(cases), CASE_COLUMNS),
    'README.txt': readme,
  }));
}));

app.get('/api/policy', authenticate, asyncHandler(async (req, res) => res.json(await clients.privacy.policy())));
app.get('/api/notifications', authenticate, requireRole('verifier', 'auditor'), asyncHandler(async (req, res) => res.json(await clients.notify.list())));
const EVAL_ROLES = ['auditor', 'admin'];
const reportFile = (name) => path.join(process.env.REPORTS_DIR || path.join(ROOT, 'reports'), name);
const readReport = (name) => {
  if (!fs.existsSync(reportFile(name))) throw new HttpError(404, 'NO_REPORT', 'Belum ada laporan evaluasi. Jalankan: npm run evaluate');
  return fs.readFileSync(reportFile(name), 'utf8');
};
app.get('/api/evaluation/latest', authenticate, requireRole(...EVAL_ROLES), (req, res) => res.type('application/json').send(readReport('metrics.json')));
app.get('/api/impact/scenarios', authenticate, requireRole(...EVAL_ROLES), (req, res) => {
  const scenarios = impactScenarios(JSON.parse(readReport('metrics.json')));
  res.json({ scenarios, note: 'Semua skenario adalah asumsi. Rupiah recall dari hasil evaluasi data sintetis, bukan hasil pada data BPJS.' });
});
// Evidence card (HTML dari eval-kit) dibuka di iframe, yang tidak bisa mengirim header Authorization; token sesi dikirim lewat query.
app.get('/api/evaluation/evidence', (req, res, next) => {
  if (req.query.access_token) req.headers.authorization = `Bearer ${String(req.query.access_token)}`;
  next();
}, authenticate, requireRole(...EVAL_ROLES), (req, res) => {
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:");
  const file = ['evidence.html', 'evidence-hard.html'].includes(req.query.file) ? req.query.file : 'evidence.html';
  res.type('html').send(readReport(file));
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

// ---------- Swagger UI (/docs) dari docs/openapi.yaml ----------
const docsCsp = (req, res, next) => { res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"); next(); };
app.get('/docs', docsCsp, (req, res) => res.type('html').send('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>SAMAR API</title><link rel="stylesheet" href="/docs/assets/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/docs/assets/swagger-ui-bundle.js"></script><script src="/docs/init.js"></script></body></html>'));
app.get('/docs/init.js', docsCsp, (req, res) => res.type('js').send("window.ui = SwaggerUIBundle({ url: '/docs/openapi.yaml', dom_id: '#swagger-ui' });"));
app.get('/docs/openapi.yaml', (req, res) => res.type('text/yaml').send(fs.readFileSync(path.join(ROOT, 'docs', 'openapi.yaml'), 'utf8')));
app.use('/docs/assets', docsCsp, express.static(swaggerDir));

app.use('/api', notFound);
app.use(express.static(webDir, { maxAge: 0, etag: true }));
app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.host, port: config.ports.gateway, logger, onShutdown: () => store.close() });
