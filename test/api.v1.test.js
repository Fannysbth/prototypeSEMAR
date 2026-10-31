// T2: API /api/v1 end-to-end dengan layanan ml sungguhan (Python): RBAC, /verify, alur kasus, audit, revoke, rotasi, ekspor, Swagger.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { startStack } from '../scripts/stack.js';
import { ROOT } from '../shared/config.js';

const KEY = 'v1-internal-key-'.padEnd(40, 'x');
const py = ['Scripts/python.exe', 'bin/python'].map((p) => path.join(ROOT, 'services/ml/.venv', p)).find((p) => fs.existsSync(p)) ?? 'python';
const mlDeps = spawnSync(py, ['-c', 'import sklearn, pandas, joblib, fastapi, uvicorn'], { stdio: 'ignore' }).status === 0;
const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samar-reports-'));
let stack; let base; let mlReady = false;
const tok = {};
const api = async (p, { method = 'GET', body, token, raw } = {}) => {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res;
  let json = null; try { json = await res.json(); } catch { /* kosong */ }
  return { status: res.status, json };
};
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
const claim = (id, o = {}) => ({ claim_id: id, level: 'FKRTL', participant_id: 'PSTV01-aaaa0001', facility_id: 'RS-A', admit_date: '2026-10-01', discharge_date: '2026-10-05', diagnosis_primary: 'J18.9', procedures: ['87.44'], billed_amount: 6200000, ...o });

test.before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'services/ml/data/train.csv'))) spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-training-set.js')], { stdio: 'ignore' });
  fs.writeFileSync(path.join(reportsDir, 'metrics.json'), JSON.stringify({ impact_inputs: { rupiah_recall: { low: 0.2, mid: 0.3, high: 0.5 } }, detection: {} }));
  fs.writeFileSync(path.join(reportsDir, 'evidence.html'), '<!doctype html><title>kartu</title><script>document.title=1</script>');
  stack = await startStack({ quiet: true, env: {
    REPORTS_DIR: reportsDir, STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test', ML_ENABLED: mlDeps ? 'true' : 'false', LLM_API_KEY: '',
    JWT_SECRET: 'v1-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 'v1-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5490', AUTH_PORT: '5491', PRIVACY_PORT: '5492', CLAIMS_PORT: '5493', FRAUD_PORT: '5494', NOTIFY_PORT: '5495', ML_PORT: '5496',
    RATE_LIMIT_PER_MIN: '100000', VERIFY_RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '100', REIDENTIFY_MAX_PER_HOUR: '50', REIDENTIFY_MAX_PER_DAY: '50',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', TOKEN_TTL_SECONDS: '2592000', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', ML_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl;
  for (const [k, u, p] of [['fac', 'rs.melati', 'demo-melati'], ['ver', 'verifikator', 'demo-verifikator'], ['aud', 'auditor', 'demo-auditor'], ['adm', 'admin', 'demo-admin']]) tok[k] = await login(u, p);
  for (let i = 0; i < 80 && mlDeps && !mlReady; i += 1) {
    mlReady = (await api('/health')).json?.ml?.available === true;
    if (!mlReady) await new Promise((r) => setTimeout(r, 500));
  }
});
test.after(async () => { await stack?.stop(); });

test('RBAC per endpoint: peran di luar daftar selalu 403, tanpa token 401', async () => {
  const matrix = [
    ['GET', '/me', ['fac', 'ver', 'aud', 'adm']], ['POST', '/claims/upload', ['fac', 'ver']], ['POST', '/verify', ['ver', 'adm']],
    ['GET', '/cases', ['ver', 'aud']], ['GET', '/cases/CASE-x', ['ver', 'aud']], ['PATCH', '/cases/CASE-x', ['ver', 'aud']], ['POST', '/cases/CASE-x/explain', ['ver', 'aud']],
    ['POST', '/cases/CASE-x/reveal', ['aud']], ['POST', '/tokens/revoke', ['adm']], ['POST', '/keys/rotate', ['adm']], ['PUT', '/settings/threshold', ['adm']],
    ['GET', '/dashboard/summary', ['ver', 'aud', 'adm']], ['POST', '/impact/simulate', ['aud', 'adm']], ['GET', '/reports/cases.csv', ['aud']],
    ['GET', '/export/evalkit', ['adm']], ['GET', '/audit', ['adm']], ['GET', '/audit/verify', ['adm']],
    ['GET', '/evaluation/latest', ['aud', 'adm']], ['GET', '/evaluation/evidence', ['aud', 'adm']], ['GET', '/impact/scenarios', ['aud', 'adm']],
  ];
  for (const [method, p, allowed] of matrix) {
    assert.equal((await api(p, { method, body: method === 'GET' ? undefined : {} })).status, 401, `${method} ${p} tanpa token`);
    for (const role of ['fac', 'ver', 'aud', 'adm']) {
      const r = await api(p, { method, token: tok[role], body: method === 'GET' ? undefined : {}, raw: true });
      assert.equal(r.status === 403, !allowed.includes(role), `${method} ${p} sebagai ${role} -> ${r.status}`);
    }
  }
});

test('/verify: bentuk respons sesuai spesifikasi, validasi 422, token ikut keluar tanpa identitas', async () => {
  const bad = await api('/verify', { method: 'POST', token: tok.ver, body: { ...claim('V-BAD1'), diagnosis_primary: 'bukan-icd' } });
  assert.equal(bad.status, 422);
  const r = await api('/verify', { method: 'POST', token: tok.ver, body: claim('V-OK-0001') });
  assert.equal(r.status, 200);
  for (const k of ['claim_id', 'subject_token', 'score', 'risk', 'case_id', 'signals', 'explanation', 'explanation_source', 'model_version', 'latency_ms']) assert.ok(k in r.json, k);
  assert.match(r.json.subject_token, /^PSE_FRD_/); assert.ok(!JSON.stringify(r.json).includes('PSTV01-aaaa0001'));
  if (mlDeps) { assert.ok(mlReady, 'ml harus siap'); assert.equal(r.json.ml_status, 'ok'); }
});

test('/verify: p95 latensi < 1 detik', async () => {
  const lat = [];
  for (let i = 0; i < 40; i += 1) {
    const t0 = performance.now();
    const r = await api('/verify', { method: 'POST', token: tok.ver, body: claim(`V-LAT-${String(i).padStart(4, '0')}`, { participant_id: `PSTV01-lat${i}x`, billed_amount: 6200000 + i * 1000 }) });
    assert.equal(r.status, 200); lat.push(performance.now() - t0);
  }
  lat.sort((a, b) => a - b);
  assert.ok(lat[Math.floor(0.95 * lat.length)] < 1000, `p95 ${lat[Math.floor(0.95 * lat.length)].toFixed(0)} ms`);
});

let caseId; let subjectToken;
test('alur demo: klaim cloning lintas 2 RS jadi kasus HIGH, riwayat token, status, penjelasan, reveal, audit', async () => {
  const p = { participant_id: 'PSTV01-cross0001' };
  await api('/verify', { method: 'POST', token: tok.ver, body: claim('X-INAP-A1', { ...p, facility_id: 'RS-A', admit_date: '2026-10-10', discharge_date: '2026-10-14' }) });
  const r = await api('/verify', { method: 'POST', token: tok.ver, body: claim('X-INAP-B1', { ...p, facility_id: 'RS-B', admit_date: '2026-10-11', discharge_date: '2026-10-14' }) });
  assert.ok(r.json.case_id, 'rawat inap tumpang tindih harus jadi kasus');
  assert.ok(r.json.signals.some((s) => s.modus === 'PHANTOM_BILLING'));
  caseId = r.json.case_id; subjectToken = r.json.subject_token;

  assert.ok((await api('/cases?risk=HIGH&modus=PHANTOM_BILLING&faskes=RS-A', { token: tok.ver })).json.items.some((c) => c.case_id === caseId));
  const d = (await api(`/cases/${caseId}`, { token: tok.aud })).json;
  assert.equal(d.status, 'BARU'); assert.deepEqual([...new Set(d.history.map((h) => h.facility_id))].sort(), ['RS-A', 'RS-B']);
  assert.ok(!JSON.stringify(d).includes('PSTV01-cross0001'));

  const ex = await api(`/cases/${caseId}/explain`, { method: 'POST', token: tok.ver });
  assert.equal(ex.json.explanation_source, 'template'); assert.match(ex.json.explanation, /tumpang tindih/);
  assert.equal((await api(`/cases/${caseId}`, { token: tok.ver })).json.explanation_source, 'template');

  assert.equal((await api(`/cases/${caseId}`, { method: 'PATCH', token: tok.ver, body: { status: 'DITINJAU', note: 'mulai verifikasi' } })).status, 200);
  assert.equal((await api(`/cases/${caseId}`, { method: 'PATCH', token: tok.ver, body: { status: 'ACAK' } })).status, 400);
  assert.equal((await api(`/cases/${caseId}`, { method: 'PATCH', token: tok.ver, body: { status: 'TERKONFIRMASI', note: 'dokumen tidak ada' } })).status, 200);
  const ev = (await api(`/cases/${caseId}`, { token: tok.ver })).json.events;
  assert.deepEqual(ev.map((e) => e.to_status), ['BARU', 'DITINJAU', 'TERKONFIRMASI']);

  assert.equal((await api(`/cases/${caseId}/reveal`, { method: 'POST', token: tok.aud, body: { reason: 'pendek' } })).status, 400);
  const rv = await api(`/cases/${caseId}/reveal`, { method: 'POST', token: tok.aud, body: { reason: 'Verifikasi dokumen klaim ke dua faskes terkait' } });
  assert.equal(rv.status, 200); assert.equal(rv.json.patient_nik, 'PSTV01-cross0001');

  const audit = (await api('/audit', { token: tok.adm })).json.items;
  assert.ok(audit.some((a) => a.action === 'CASE_STATUS' && a.case_id === caseId));
  assert.ok(audit.some((a) => a.action === 'REIDENTIFY' && a.status === 'SUCCESS' && a.actor === 'auditor'));
  assert.deepEqual((await api('/audit/verify', { token: tok.adm })).json.valid, true);
});

test('revoke (admin): token tercabut ditolak di analitik; rotasi epoch (admin) mengganti token baru', async () => {
  assert.equal((await api('/tokens/revoke', { method: 'POST', token: tok.adm, body: { subject_token: subjectToken, reason: 'permintaan subjek' } })).status, 200);
  const again = await api('/verify', { method: 'POST', token: tok.ver, body: claim('X-REV-0001', { participant_id: 'PSTV01-cross0001' }) });
  assert.equal(again.status, 403); assert.equal(again.json.error.code, 'SUBJECT_REVOKED');

  const before = (await api('/verify', { method: 'POST', token: tok.ver, body: claim('X-ROT-0001', { participant_id: 'PSTV01-rotasi01' }) })).json.subject_token;
  assert.ok((await api('/keys/rotate', { method: 'POST', token: tok.adm })).json.rotation >= 1);
  const after = (await api('/verify', { method: 'POST', token: tok.ver, body: claim('X-ROT-0002', { participant_id: 'PSTV01-rotasi01' }) })).json.subject_token;
  assert.notEqual(before, after);
  assert.equal((await api('/audit/verify', { token: tok.adm })).json.valid, true);
});

test('ambang kasus diubah admin dan tercatat di audit', async () => {
  assert.equal((await api('/settings/threshold', { token: tok.ver })).json.case_score, 45);
  assert.equal((await api('/settings/threshold', { method: 'PUT', token: tok.adm, body: { case_score: 5 } })).status, 400);
  assert.equal((await api('/settings/threshold', { method: 'PUT', token: tok.adm, body: { case_score: 60 } })).json.case_score, 60);
  assert.ok((await api('/audit', { token: tok.adm })).json.items.some((a) => a.action === 'THRESHOLD_CHANGE'));
  await api('/settings/threshold', { method: 'PUT', token: tok.adm, body: { case_score: 45 } });
});

test('dashboard, simulasi dampak, ekspor CSV dan eval-kit, Swagger /docs', async () => {
  const dsh = (await api('/dashboard/summary', { token: tok.aud })).json;
  assert.ok(dsh.claims_total > 40 && dsh.cases_total >= 1 && dsh.cases_by_level);
  const sim = await api('/impact/simulate', { method: 'POST', token: tok.aud, body: { annual_claim_value: 1e12, fraud_rate: 0.03, review_capacity: 0.01, precision_at_k: 0.5, recovery_rate: 0.6, biaya_operasional: 1e9 } });
  assert.equal(sim.json.result.potensi_pemulihan_rp, 3e9); assert.ok(sim.json.assumptions.length >= 4);
  const csv = await (await api('/reports/cases.csv', { token: tok.aud, raw: true })).text();
  assert.match(csv.split('\n')[0], /^case_id,claim_id,subject_token/); assert.ok(!csv.includes('PSTV01-'));
  const zip = Buffer.from(await (await api('/export/evalkit', { token: tok.adm, raw: true })).arrayBuffer());
  assert.equal(zip.subarray(0, 2).toString(), 'PK'); assert.ok(zip.includes('entity_id,group_id,score,stratum'));
  const docs = await fetch(`${base}/docs`); assert.equal(docs.status, 200); assert.match(await docs.text(), /swagger-ui/);
  assert.match(await (await fetch(`${base}/docs/openapi.yaml`)).text(), /openapi: 3/);
  assert.equal((await fetch(`${base}/docs/assets/swagger-ui-bundle.js`)).status, 200);
});

test('demo/fkrtl_batch_november.csv: unggah CSV menghasilkan kasus phantom dan cloning lintas 2 RS', async () => {
  const csv = fs.readFileSync(path.join(ROOT, 'demo', 'fkrtl_batch_november.csv'), 'utf8');
  const res = await fetch(`${base}/api/v1/claims/upload`, { method: 'POST', headers: { 'content-type': 'text/csv', authorization: `Bearer ${tok.ver}` }, body: csv });
  const b = await res.json();
  assert.equal(b.rejected, 0, JSON.stringify(b.errors)); assert.equal(b.accepted, 40);
  const cases = (await api('/cases?risk=HIGH', { token: tok.ver })).json.items;
  const cloning = cases.filter((c) => c.modi.includes('CLONING'));
  assert.deepEqual([...new Set(cloning.map((c) => c.facility_id))].sort(), ['RS-A', 'RS-B']);
  const phantom = cases.find((c) => c.modi.includes('PHANTOM_BILLING') && c.claim_id.startsWith('FKL-NOV'));
  assert.deepEqual(phantom.facilities, ['RS-A', 'RS-B']);
  assert.equal((await api(`/claims/batches/${b.batch_id}`, { token: tok.ver })).json.cases, b.cases);
});

test('frontend web/ disajikan gateway (HTML, JS, CSS) dengan CSP ketat', async () => {
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200); assert.match(await idx.text(), /SAMAR/);
  assert.match(idx.headers.get('content-security-policy'), /script-src 'self'/);
  for (const f of ['/app.js', '/style.css']) assert.equal((await fetch(`${base}${f}`)).status, 200, f);
});

test('halaman evaluasi: metrik, skenario dampak, dan evidence card hanya untuk auditor/admin', async () => {
  const ev = await api('/evaluation/latest', { token: tok.aud });
  assert.equal(ev.status, 200); assert.ok('impact_inputs' in ev.json);
  const sc = await api('/impact/scenarios', { token: tok.adm });
  assert.deepEqual(sc.json.scenarios.map((x) => x.id), ['rendah', 'sedang', 'tinggi']);
  assert.ok(sc.json.scenarios.every((x) => x.label === 'asumsi'));
  // iframe tidak bisa mengirim header Authorization: token lewat query, tetap diperiksa perannya
  const html = await fetch(`${base}/api/v1/evaluation/evidence?access_token=${tok.aud}`);
  assert.equal(html.status, 200); assert.match(html.headers.get('content-type'), /html/); assert.match(html.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(`${base}/api/v1/evaluation/evidence?access_token=${tok.fac}`)).status, 403);
  assert.equal((await fetch(`${base}/api/v1/evaluation/evidence?access_token=${tok.ver}`)).status, 403);
  assert.equal((await fetch(`${base}/api/v1/evaluation/evidence`)).status, 401);
});
