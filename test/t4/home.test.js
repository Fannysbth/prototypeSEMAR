// T4: beranda per peran dan daftar klaim ter-token (pratinjau seperti sistem nyata, tanpa PII).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack } from '../../scripts/stack.js';
import { ROOT } from '../../shared/config.js';

const KEY = 't4h-internal-key-'.padEnd(40, 'x');
let stack; let base; let topCase;
const tok = {};
const api = async (p, { method = 'GET', body, token, text } = {}) => {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { ...(text ? { 'content-type': 'text/csv' } : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: text ?? (body ? JSON.stringify(body) : undefined) });
  const raw = await res.text(); let json = null; try { json = JSON.parse(raw); } catch { /* bukan JSON */ }
  return { status: res.status, json, raw };
};
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
const csvOf = (f) => fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');

test.before(async () => {
  stack = await startStack({ quiet: true, env: {
    STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test', ML_ENABLED: 'false', LLM_API_KEY: '',
    JWT_SECRET: 't4h-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 't4h-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5440', AUTH_PORT: '5441', PRIVACY_PORT: '5442', CLAIMS_PORT: '5443', FRAUD_PORT: '5444', NOTIFY_PORT: '5445', ML_PORT: '5446',
    RATE_LIMIT_PER_MIN: '100000', VERIFY_RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '100', REIDENTIFY_MAX_PER_HOUR: '7', REIDENTIFY_MAX_PER_DAY: '20',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', ML_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl;
  for (const [k, u, p] of [['a', 'rs.melati', 'demo-melati'], ['b', 'rs.kenanga', 'demo-kenanga'], ['ver', 'verifikator', 'demo-verifikator'], ['aud', 'auditor', 'demo-auditor'], ['adm', 'admin', 'demo-admin']]) tok[k] = await login(u, p);
  assert.equal((await api('/claims/upload', { method: 'POST', token: tok.a, text: csvOf('fkrtl_batch_november_RS-A.csv') })).status, 200);
  assert.equal((await api('/claims/upload', { method: 'POST', token: tok.b, text: `${csvOf('fkrtl_batch_november_RS-B.csv').trim()}\nBAD-1,RS-B,123,x,y,z,r,J18.9,87.44,RI,2026-11-01,4,6200000\n` })).status, 200);
  topCase = (await api('/cases', { token: tok.ver })).json.items[0];
  await api(`/cases/${topCase.case_id}/request-file`, { method: 'POST', token: tok.ver, body: { note: 'Mohon kirim resume medis klaim ini' } });
  await api(`/cases/${topCase.case_id}/reveal`, { method: 'POST', token: tok.aud, body: { reason: 'Konfirmasi identitas untuk keperluan audit internal' } });
});
test.after(async () => { await stack?.stop(); });

test('beranda faskes: riwayat unggahan sendiri, kualitas data, permintaan berkas; tanpa skor atau kasus', async () => {
  const h = (await api('/home', { token: tok.b })).json;
  assert.equal(h.role, 'facility');
  assert.equal(h.uploads.length, 1);
  assert.equal(h.quality.total_rows, 17); assert.equal(h.quality.accepted, 16);
  assert.ok(h.quality.top_errors.length >= 1 && h.quality.top_errors[0].count >= 1);
  assert.ok(!/risk|skor|score|case_id|kasus/i.test(JSON.stringify(h.uploads)));
  const target = topCase.facility_id === 'RS-A' ? 'a' : 'b'; const other = target === 'a' ? 'b' : 'a';
  const own = (await api('/home', { token: tok[target] })).json; const rest = (await api('/home', { token: tok[other] })).json;
  assert.equal(own.uploads.length, 1); assert.equal(own.file_requests.length, 1);
  assert.equal(rest.file_requests.length, 0, 'permintaan berkas hanya muncul di faskes tujuan');
});

test('beranda verifikator: antrian urut skor, kasus baru hari ini, per modus, umur kasus, aktivitas', async () => {
  const h = (await api('/home', { token: tok.ver })).json;
  assert.equal(h.role, 'verifier');
  const scores = h.queue.map((c) => c.risk_score);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
  assert.ok(h.new_today >= 1 && Object.keys(h.by_modus).length >= 1);
  assert.deepEqual(Object.keys(h.age).sort(), ['d1_3', 'gt_3', 'lt_1d']);
  assert.ok(h.activity.length >= 1 && h.activity.every((e) => e.at_ms && e.case_id));
  assert.ok(!/9999\d{12}/.test(JSON.stringify(h)));
});

test('beranda auditor: kasus eskalasi dan log reveal milik sendiri saja', async () => {
  await api(`/cases/${topCase.case_id}/escalate`, { method: 'POST', token: tok.ver, body: { note: 'Perlu konfirmasi identitas peserta' } });
  const h = (await api('/home', { token: tok.aud })).json;
  assert.equal(h.role, 'auditor');
  assert.ok(h.escalated.some((c) => c.case_id === topCase.case_id));
  assert.ok(h.my_reveals.length >= 1 && h.my_reveals.every((r) => r.actor === 'auditor' && r.action === 'REIDENTIFY'));
  assert.ok(!JSON.stringify(h.my_reveals).includes('9999'), 'log reveal tidak memuat NIK');
});

test('beranda admin: kesehatan layanan, rantai audit, kuota reveal', async () => {
  const h = (await api('/home', { token: tok.adm })).json;
  assert.equal(h.role, 'admin');
  assert.ok(Object.values(h.services).every(Boolean));
  assert.equal(h.audit.valid, true); assert.ok(h.audit.entries >= 3);
  assert.equal(h.quota.max_per_hour, 7); assert.equal(h.quota.max_per_day, 20);
  assert.equal(h.quota.usage.find((u) => u.actor === 'auditor').last_hour, 1);
});

test('daftar klaim ter-token: token sebagian, filter, pencarian; tanpa identitas; hanya verifikator, auditor, admin', async () => {
  const all = (await api('/claims/tokenized?limit=200', { token: tok.ver })).json;
  assert.equal(all.total, 25);
  assert.deepEqual(Object.keys(all.items[0]).sort(), ['admit_date', 'amount', 'case_id', 'claim_id', 'diagnosis_code', 'facility_id', 'risk_level', 'score', 'status', 'token'].sort());
  assert.match(all.items[0].token, /^PSE_FRD_[0-9A-F]{6}\.\.\.$/);
  assert.ok(!/9999\d{12}/.test(JSON.stringify(all)) && !JSON.stringify(all).includes('PSE_FRD_AAAAAAAAAAAAAAAAAAAA'));
  assert.ok((await api('/claims/tokenized?facility=RS-B', { token: tok.aud })).json.items.every((c) => c.facility_id === 'RS-B'));
  assert.equal((await api(`/claims/tokenized?q=${topCase.claim_id}`, { token: tok.ver })).json.items.length, 1);
  assert.ok((await api('/claims/tokenized?min_score=70', { token: tok.ver })).json.items.every((c) => c.score >= 70));
  assert.ok((await api('/claims/tokenized?status=ESKALASI', { token: tok.ver })).json.items.every((c) => c.status === 'ESKALASI'));
  assert.ok((await api('/claims/tokenized?diagnosis=N39.0', { token: tok.adm })).json.items.every((c) => c.diagnosis_code === 'N39.0'));
  assert.equal((await api('/claims/tokenized', { token: tok.a })).status, 403);
});
