// T1: unggah CSV batch, login 4 peran, dan zone-leak (PII tidak boleh sampai ke zona token).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from '../scripts/stack.js';
import { generateDataset } from '../scripts/generate-data/index.js';
import { scanForPii } from '../shared/pii.js';
import { parseCsv } from '../shared/csv.js';

const KEY = 'upl-internal-key-'.padEnd(40, 'x');
let stack; let base;
const api = async (path, { method = 'GET', body, token, type = 'application/json' } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body });
  let json = null; try { json = await res.json(); } catch { /* kosong */ }
  return { status: res.status, json };
};
const login = async (username, password) => (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).json?.token;

test.before(async () => {
  stack = await startStack({ quiet: true, env: {
    STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test',
    JWT_SECRET: 'upl-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 'upl-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5390', AUTH_PORT: '5391', PRIVACY_PORT: '5392', CLAIMS_PORT: '5393', FRAUD_PORT: '5394', NOTIFY_PORT: '5395',
    RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '50', REIDENTIFY_MAX_PER_HOUR: '6',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', TOKEN_TTL_SECONDS: '2592000', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl;
});
test.after(async () => { await stack?.stop(); });

test('login 4 peran: faskes, verifikator, auditor, admin', async () => {
  for (const [u, p, role] of [['rs.melati', 'demo-melati', 'facility'], ['verifikator', 'demo-verifikator', 'verifier'], ['auditor', 'demo-auditor', 'auditor'], ['admin', 'demo-admin', 'admin']]) {
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    assert.equal(r.status, 200, u);
    assert.equal(r.json.user.role, role);
  }
});

test('unggah CSV: baris valid diterima, baris rusak dilaporkan, tanpa token ditolak', async () => {
  const csv = [
    'facility_id,patient_nik,patient_name,phone,birth_date,record_number,diagnosis_code,procedure_code,claim_type,admit_date,length_of_stay,amount',
    'RS-A,9999000011112222,Budi Santoso,081234567890,1980-01-02,RM-A-1,J18.9,87.44,RI,2026-09-10,4,6200000',
    'RS-A,3273011234567890,Siti Rahayu,081234567891,1981-01-02,RM-A-2,J18.9,87.44,RI,2026-09-10,4,6200000',
    'RS-Z,9999000011113333,Agus Hidayat,081234567892,1982-01-02,RM-A-3,J18.9,87.44,RI,2026-09-10,4,6200000',
  ].join('\n');
  assert.equal((await api('/api/claims/upload', { method: 'POST', body: csv, type: 'text/csv' })).status, 401);
  const ver = await login('verifikator', 'demo-verifikator');
  const r = await api('/api/claims/upload', { method: 'POST', body: csv, type: 'text/csv', token: ver });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.total, r.json.accepted, r.json.rejected], [3, 1, 2]);
  assert.deepEqual(r.json.errors.map((e) => e.row), [3, 4]);
  const b = await api(`/api/claims/batches/${r.json.batch_id}`, { token: ver });
  assert.equal(b.json.accepted, 1);
  const mel = await login('rs.melati', 'demo-melati');
  assert.equal((await api('/api/claims/upload', { method: 'POST', body: csv, type: 'text/csv', token: await login('auditor', 'demo-auditor') })).status, 403);
  assert.equal((await api(`/api/claims/batches/${r.json.batch_id}`, { token: mel })).status, 404);
});

test('unggah 5.000 peserta sintetis sukses dan zona token bebas PII (zone-leak)', { timeout: 280000 }, async () => {
  const { claimsCsv } = generateDataset({ peserta: 5000, seed: 42 });
  const ver = await login('verifikator', 'demo-verifikator');
  await api('/api/demo/tap', { method: 'DELETE', token: ver });
  const r = await api('/api/claims/upload', { method: 'POST', body: claimsCsv, type: 'text/csv', token: ver });
  assert.equal(r.status, 200);
  assert.equal(r.json.rejected, 0, JSON.stringify(r.json.errors?.slice(0, 3)));
  assert.ok(r.json.accepted >= 5000);
  const rows = parseCsv(claimsCsv);
  const known = new Map();
  for (const x of rows.slice(0, 200)) for (const k of ['patient_nik', 'patient_name', 'phone', 'birth_date', 'record_number']) known.set(x[k], k);
  for (const svc of ['claims', 'fraud', 'notify']) {
    const tap = (await api(`/api/demo/tap/${svc}`, { token: ver })).json.items;
    assert.ok(tap.length > 0, svc);
    assert.deepEqual(scanForPii(tap.map((t) => t.body), known), [], `PII bocor ke ${svc}`);
  }
});
