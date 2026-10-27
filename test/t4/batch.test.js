// T4: layar proses unggahan. Status batch bertahap (polling); faskes hanya melihat Validasi, Tokenisasi, Selesai tanpa skor atau kasus.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack } from '../../scripts/stack.js';
import { ROOT } from '../../shared/config.js';

const KEY = 't4b-internal-key-'.padEnd(40, 'x');
let stack; let base;
const tok = {};
const api = async (p, { method = 'GET', body, token, text } = {}) => {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { ...(text ? { 'content-type': 'text/csv' } : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: text ?? (body ? JSON.stringify(body) : undefined) });
  const raw = await res.text(); let json = null; try { json = JSON.parse(raw); } catch { /* bukan JSON */ }
  return { status: res.status, json, raw };
};
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
const csvOf = (f) => fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');
const finished = async (id, token) => {
  for (let i = 0; i < 100; i += 1) {
    const r = await api(`/claims/batches/${id}`, { token });
    if (r.json.status === 'SELESAI') return r.json;
    await new Promise((x) => setTimeout(x, 100));
  }
  throw new Error('batch tidak selesai');
};

test.before(async () => {
  stack = await startStack({ quiet: true, env: {
    STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test', ML_ENABLED: 'false', LLM_API_KEY: '',
    JWT_SECRET: 't4b-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 't4b-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5450', AUTH_PORT: '5451', PRIVACY_PORT: '5452', CLAIMS_PORT: '5453', FRAUD_PORT: '5454', NOTIFY_PORT: '5455', ML_PORT: '5456',
    RATE_LIMIT_PER_MIN: '100000', VERIFY_RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '100',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', ML_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl;
  for (const [k, u, p] of [['a', 'rs.melati', 'demo-melati'], ['b', 'rs.kenanga', 'demo-kenanga'], ['ver', 'verifikator', 'demo-verifikator']]) tok[k] = await login(u, p);
});
test.after(async () => { await stack?.stop(); });

test('unggah async: balasan 202 segera, lalu status bertahap sampai SELESAI; faskes hanya 3 tahap tanpa skor atau kasus', async () => {
  const up = await api('/claims/upload?async=true', { method: 'POST', token: tok.a, text: csvOf('fkrtl_batch_november_RS-A.csv') });
  assert.equal(up.status, 202);
  assert.ok(['DIPROSES', 'SELESAI'].includes(up.json.status));
  const b = await finished(up.json.batch_id, tok.a);
  assert.deepEqual(b.stages.map((s) => s.id), ['validasi', 'tokenisasi', 'selesai']);
  assert.deepEqual(b.stages.map((s) => s.count), [9, 9, 9]);
  for (const k of ['cases', 'flagged', 'analyzed', 'cross_facility', 'risk_score']) assert.ok(!(k in b), `faskes tidak boleh melihat ${k}`);
  assert.ok(!/risk|skor|score|case_id|CLONING|PHANTOM/i.test(JSON.stringify(b.stages)));
});

test('pratinjau 20 baris pertama tanpa NIK, nama, atau telepon penuh; baris gagal beserta alasannya', async () => {
  const bad = `${csvOf('fkrtl_batch_november_RS-A.csv').trim().replaceAll('FKL-NOV-', 'FKL-PRV-')}\nFKL-BAD-1,RS-A,3273011234567890,Nama Riil,081234567890,1980-01-01,RM-1,J18.9,87.44,RI,2026-11-01,4,6200000\n`;
  const up = await api('/claims/upload', { method: 'POST', token: tok.a, text: bad });
  assert.equal(up.status, 200);
  assert.equal(up.json.rejected, 1); assert.equal(up.json.errors[0].row, 11);
  assert.ok(up.json.preview.length === 10 && up.json.preview.length <= 20);
  const text = JSON.stringify(up.json.preview);
  assert.ok(!/\b\d{16}\b/.test(text), 'NIK penuh di pratinjau');
  assert.ok(!/08\d{8,}/.test(text), 'telepon penuh di pratinjau');
  assert.deepEqual(Object.keys(up.json.preview[0]).sort(), ['admit_date', 'amount', 'claim_ref', 'diagnosis_code', 'facility_id', 'patient_hint', 'row'].sort());
  assert.ok(!('cases' in up.json), 'respons unggah faskes tidak memuat jumlah kasus');
});

test('verifikator melihat 5 tahap lengkap dengan angka fitur lintas faskes, deteksi, dan kasus', async () => {
  const up = await api('/claims/upload?async=true', { method: 'POST', token: tok.ver, text: csvOf('fkrtl_batch_november_RS-B.csv') });
  const b = await finished(up.json.batch_id, tok.ver);
  assert.deepEqual(b.stages.map((s) => s.id), ['validasi', 'tokenisasi', 'fitur_lintas_faskes', 'deteksi', 'kasus']);
  assert.equal(b.stages[0].count, 16); assert.equal(b.stages[1].count, 16);
  assert.ok(b.stages[4].count >= 1, 'RS-B punya kasus cloning');
  assert.equal(b.stages[4].count, b.cases);
});

test('batch milik pengguna lain tidak bisa dibaca (IDOR) dan status batch memerlukan login', async () => {
  const up = await api('/claims/upload', { method: 'POST', token: tok.a, text: csvOf('fkrtl_batch_november_RS-A.csv') });
  assert.equal((await api(`/claims/batches/${up.json.batch_id}`, { token: tok.b })).status, 404);
  assert.equal((await api(`/claims/batches/${up.json.batch_id}`)).status, 401);
});
