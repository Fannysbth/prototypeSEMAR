// Tes end-to-end: menyalakan seluruh microservice sungguhan (store memory) dan menembak API publik.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../scripts/stack.js';
import { scanForPii } from '../shared/pii.js';
import { dropSchemas } from '../shared/store.js';

const PG = process.env.TEST_DATABASE_URL; // opsional: jalankan e2e di Postgres/Neon sungguhan

const KEY = 'e2e-internal-key-'.padEnd(40, 'x');
let stack; let base; let internal;
const tokens = {};

const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* kosong */ }
  return { status: res.status, json };
};
const login = async (username, password) => (await api('/api/auth/login', { method: 'POST', body: { username, password } })).json.token;
const CLAIM = { patient_nik: '9999555566667777', patient_name: 'Siti Rahayu', phone: '081298765432', birth_date: '1992-02-02', record_number: 'RM-A-777', diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', admit_date: '2026-09-10', length_of_stay: 4, amount: 6200000 };

test.before(async () => {
  if (PG) await dropSchemas(PG, ['privacy', 'claims', 'fraud', 'notify']);
  stack = await startStack({ quiet: true, env: {
    STORE: PG ? 'postgres' : 'memory', ...(PG ? { DATABASE_URL: PG } : {}), DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test',
    JWT_SECRET: 'e2e-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 'e2e-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5290', AUTH_PORT: '5291', PRIVACY_PORT: '5292', CLAIMS_PORT: '5293', FRAUD_PORT: '5294', NOTIFY_PORT: '5295',
    RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '8', REIDENTIFY_MAX_PER_HOUR: '6',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', TOKEN_TTL_SECONDS: '2592000', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl; internal = stack.config.urls;
  tokens.melati = await login('rs.melati', 'demo-melati');
  tokens.kenanga = await login('rs.kenanga', 'demo-kenanga');
  tokens.ver = await login('verifikator', 'demo-verifikator');
});
test.after(async () => { await stack?.stop(); });

test('semua layanan siap (/api/ready)', async () => {
  const r = await api('/api/ready');
  assert.equal(r.status, 200); assert.ok(r.json.ready);
});

test('mode proposed: layanan hilir TIDAK menerima PII asli; mode baseline menerimanya', async () => {
  await api('/api/demo/tap', { method: 'DELETE', token: tokens.melati });
  const p = await api('/api/claims?mode=proposed', { method: 'POST', token: tokens.melati, body: CLAIM });
  assert.equal(p.status, 201);
  const known = new Map([[CLAIM.patient_nik, 'nik'], [CLAIM.patient_name, 'name'], [CLAIM.phone, 'phone'], [CLAIM.birth_date, 'birth'], [CLAIM.record_number, 'rm']]);
  for (const svc of ['claims', 'fraud']) {
    const tap = (await api(`/api/demo/tap/${svc}`, { token: tokens.melati })).json.items;
    assert.ok(tap.length >= 1);
    assert.deepEqual(scanForPii(tap.map((t) => t.body), known), [], `PII bocor ke ${svc}`);
  }
  await api('/api/demo/tap', { method: 'DELETE', token: tokens.melati });
  const b = await api('/api/claims?mode=baseline', { method: 'POST', token: tokens.melati, body: { ...CLAIM, patient_nik: '9999555566668888' } });
  assert.equal(b.status, 201);
  const tapB = (await api('/api/demo/tap/claims', { token: tokens.melati })).json.items;
  assert.ok(scanForPii(tapB.map((t) => t.body), known).includes('nik'));
});

test('deteksi lintas-faskes bekerja dan identik di kedua mode', async () => {
  const run = async (mode, nik) => {
    const out = [];
    const days = ['2026-09-01', '2026-09-02'];
    for (const [i, tok] of [tokens.melati, tokens.kenanga].entries()) {
      out.push((await api(`/api/claims?mode=${mode}`, { method: 'POST', token: tok, body: { ...CLAIM, patient_nik: nik, admit_date: days[i], length_of_stay: 1, claim_type: 'RJ', diagnosis_code: 'I10', procedure_code: '89.52', amount: 850000 } })).json.fraud);
    }
    return out;
  };
  const prop = await run('proposed', '9999111122223333');
  const base_ = await run('baseline', '9999444455556666');
  assert.ok(prop[1].flags.some((f) => f.modus === 'SELF_REFERRAL'));
  assert.equal(prop[1].risk_score, base_[1].risk_score);
});

test('keamanan gerbang: tanpa token, token palsu, peran salah, input berbahaya', async () => {
  assert.equal((await api('/api/claims', { method: 'POST', body: CLAIM })).status, 401);
  assert.equal((await api('/api/claims', { method: 'POST', body: CLAIM, token: `${tokens.melati.slice(0, -4)}AAAA` })).status, 401);
  assert.equal((await api('/api/cases', { token: tokens.melati })).status, 403);
  assert.equal((await api('/api/claims', { method: 'POST', token: tokens.ver, body: CLAIM })).status, 403);
  const real = await api('/api/claims', { method: 'POST', token: tokens.melati, body: { ...CLAIM, patient_nik: '3273011234567890' } });
  assert.equal(real.status, 400); assert.match(JSON.stringify(real.json), /SINTETIS/);
  assert.equal((await api('/api/claims', { method: 'POST', token: tokens.melati, body: { ...CLAIM, is_admin: true } })).status, 400);
  assert.equal((await api('/api/claims', { method: 'POST', token: tokens.melati, body: { ...CLAIM, diagnosis_code: "J18.9'; DROP TABLE x;--" } })).status, 400);
  assert.equal((await api('/api/claims', { method: 'POST', token: tokens.melati, body: { ...CLAIM, amount: -5 } })).status, 400);
  const jwtNone = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"x","role":"verifier"}').toString('base64url')}.`;
  assert.equal((await api('/api/cases', { token: jwtNone })).status, 401);
});

test('idempotensi: Idempotency-Key yang sama ditolak 409', async () => {
  const h = { 'idempotency-key': 'e2e-idem-key-0001' };
  const claim = { ...CLAIM, patient_nik: '9999777788889999' };
  assert.equal((await api('/api/claims', { method: 'POST', token: tokens.melati, body: claim, headers: h })).status, 201);
  assert.equal((await api('/api/claims', { method: 'POST', token: tokens.melati, body: claim, headers: h })).status, 409);
});

test('layanan internal tidak bisa diakses tanpa kunci antar-layanan', async () => {
  for (const [svc, path, method] of [['privacy', '/v1/audit', 'GET'], ['claims', '/v1/claims', 'GET'], ['fraud', '/v1/cases', 'GET'], ['auth', '/v1/login', 'POST']]) {
    const r = await fetch(internal[svc] + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 401, `${svc} terbuka!`);
  }
});

test('human-in-the-loop: verifikator review kasus & membuka identitas (teraudit, berkuota)', async () => {
  const sim = await api('/api/demo/simulate/upcoding?mode=proposed', { method: 'POST', token: tokens.ver });
  const caseId = sim.json.steps[0].case_id;
  assert.ok(caseId);
  const rv = await api(`/api/cases/${caseId}/review`, { method: 'POST', token: tokens.ver, body: { decision: 'CONFIRMED_FRAUD', note: 'Nominal tidak sesuai dokumen' } });
  assert.equal(rv.json.status, 'CONFIRMED');
  assert.equal((await api(`/api/cases/${caseId}/reveal`, { method: 'POST', token: tokens.ver, body: { justification: 'pendek' } })).status, 400);
  assert.equal((await api(`/api/cases/${caseId}/reveal`, { method: 'POST', token: tokens.melati, body: { justification: 'Saya ingin melihat identitas pasien ini' } })).status, 403);
  const ok = await api(`/api/cases/${caseId}/reveal`, { method: 'POST', token: tokens.ver, body: { justification: 'Verifikasi dokumen klaim ke fasilitas kesehatan terkait' } });
  assert.equal(ok.status, 200); assert.match(ok.json.patient_nik, /^9999\d{12}$/); assert.equal(ok.json.protected, true);
  const audit = (await api('/api/audit', { token: tokens.ver })).json.items;
  assert.ok(audit.some((a) => a.action === 'REIDENTIFY' && a.status === 'SUCCESS' && a.actor === 'verifikator'));
  assert.ok(!JSON.stringify(audit).includes(ok.json.patient_nik));
  tokens.lastCase = caseId;
});

test('hak subjek: setelah revoke, identitas tidak bisa dibuka lagi', async () => {
  const nik = '9999888877776666';
  const sub = await api('/api/claims?mode=proposed', { method: 'POST', token: tokens.melati, body: { ...CLAIM, patient_nik: nik, amount: 18000000, length_of_stay: 4 } });
  const cid = sub.json.fraud.case_id; assert.ok(cid, 'upcoding harus membuat kasus');
  assert.equal((await api('/api/subjects/revoke', { method: 'POST', token: tokens.ver, body: { patient_nik: nik } })).status, 200);
  assert.equal((await api(`/api/cases/${cid}/reveal`, { method: 'POST', token: tokens.ver, body: { justification: 'Percobaan setelah subjek mencabut persetujuan' } })).status, 403);
});

test('kuota pembukaan identitas per verifikator dibatasi (429) - mencegah penyalahgunaan orang dalam', async () => {
  let got429 = false;
  for (let i = 0; i < 10 && !got429; i += 1) {
    const r = await api(`/api/cases/${tokens.lastCase}/reveal`, { method: 'POST', token: tokens.ver, body: { justification: 'Verifikasi dokumen klaim ke fasilitas kesehatan terkait' } });
    got429 = r.status === 429;
  }
  assert.ok(got429);
});

test('brute-force login dibatasi (429) setelah gagal berulang', async () => {
  let got429 = false;
  for (let i = 0; i < 14; i += 1) { const r = await api('/api/auth/login', { method: 'POST', body: { username: 'rs.melati', password: `salah-${i}` } }); if (r.status === 429) got429 = true; }
  assert.ok(got429);
});
