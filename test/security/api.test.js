// Pemeriksaan keamanan T3 pada layanan nyata: IDOR, RBAC seluruh openapi.yaml, header, CORS, kebocoran error, kunci antar-layanan, rate limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack } from '../../scripts/stack.js';
import { ROOT } from '../../shared/config.js';

const KEY = 'sec-internal-key-'.padEnd(40, 'x');
let stack; let base;
const tok = {};
const api = async (p, { method = 'GET', body, token, headers = {}, text } = {}) => {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { ...(text ? { 'content-type': 'text/csv' } : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: text ?? (body ? JSON.stringify(body) : undefined) });
  const raw = await res.text(); let json = null; try { json = JSON.parse(raw); } catch { /* bukan JSON */ }
  return { status: res.status, json, raw, headers: res.headers };
};
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
const NIK = '9999777700001111'; const NAME = 'Rahasia Tersembunyi';
const claim = (o = {}) => ({ patient_nik: NIK, patient_name: NAME, phone: '081234567890', birth_date: '1980-02-03', record_number: 'RM-A-777', diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', admit_date: '2026-10-01', length_of_stay: 4, amount: 6200000, ...o });

test.before(async () => {
  stack = await startStack({ quiet: true, env: {
    STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test', ML_ENABLED: 'false', LLM_API_KEY: '',
    JWT_SECRET: 'sec-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 'sec-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5480', AUTH_PORT: '5481', PRIVACY_PORT: '5482', CLAIMS_PORT: '5483', FRAUD_PORT: '5484', NOTIFY_PORT: '5485', ML_PORT: '5486',
    RATE_LIMIT_PER_MIN: '100000', VERIFY_RATE_LIMIT_PER_MIN: '4', LOGIN_MAX_FAILS_PER_MIN: '5', REIDENTIFY_MAX_PER_HOUR: '50', REIDENTIFY_MAX_PER_DAY: '50',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', TOKEN_TTL_SECONDS: '2592000', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', ML_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl;
  for (const [k, u, p] of [['a', 'rs.melati', 'demo-melati'], ['b', 'rs.kenanga', 'demo-kenanga'], ['ver', 'verifikator', 'demo-verifikator'], ['aud', 'auditor', 'demo-auditor'], ['adm', 'admin', 'demo-admin']]) tok[k] = await login(u, p);
});
test.after(async () => { await stack?.stop(); });

test('IDOR: faskes B tidak bisa membaca batch milik faskes A, dan daftar klaim hanya milik faskesnya sendiri', async () => {
  const csv = 'claim_ref,facility_id,patient_nik,patient_name,phone,birth_date,record_number,diagnosis_code,procedure_code,claim_type,admit_date,length_of_stay,amount\nIDOR-1,RS-A,9999777700002222,Nama Lain,081234567891,1981-01-02,RM-A-1,J18.9,87.44,RI,2026-10-02,4,6200000\n';
  const up = await api('/claims/upload', { method: 'POST', token: tok.a, text: csv });
  assert.equal(up.status, 200); assert.equal(up.json.accepted, 1);
  assert.equal((await api(`/claims/batches/${up.json.batch_id}`, { token: tok.a })).status, 200);
  assert.equal((await api(`/claims/batches/${up.json.batch_id}`, { token: tok.b })).status, 404);
  assert.equal((await api(`/claims/batches/${up.json.batch_id}`, { token: tok.ver })).status, 404, 'batch milik pengguna lain, termasuk verifikator');
  const own = await api('/claims?facility_id=RS-A', { token: tok.b });
  assert.ok(own.json.items.every((c) => c.facility_id === 'RS-B'), 'parameter facility_id dari klien tidak boleh dipercaya');
});

test('IDOR: faskes tidak boleh mengunggah baris atas nama faskes lain', async () => {
  const csv = 'claim_ref,facility_id,patient_nik,patient_name,phone,birth_date,record_number,diagnosis_code,procedure_code,claim_type,admit_date,length_of_stay,amount\nIDOR-2,RS-A,9999777700003333,Nama Tiga,081234567892,1981-01-02,RM-A-3,J18.9,87.44,RI,2026-10-02,4,6200000\n';
  const r = await api('/claims/upload', { method: 'POST', token: tok.b, text: csv });
  assert.equal(r.json.accepted, 0); assert.equal(r.json.rejected, 1);
});

// Setiap operasi di docs/openapi.yaml harus punya aturan peran yang diuji. Operasi baru tanpa baris di sini membuat tes ini gagal.
const PUBLIC = ['POST /auth/login', 'GET /health'];
const MATRIX = {
  'GET /me': ['a', 'b', 'ver', 'aud', 'adm'], 'POST /claims/upload': ['a', 'b', 'ver'], 'GET /claims/batches/x': ['a', 'b', 'ver'], 'POST /verify': ['ver', 'adm'],
  'GET /cases': ['ver', 'aud'], 'GET /cases/x': ['ver', 'aud'], 'PATCH /cases/x': ['ver', 'aud'], 'POST /cases/x/explain': ['ver', 'aud'], 'POST /cases/x/reveal': ['aud'],
  'POST /tokens/revoke': ['adm'], 'POST /keys/rotate': ['adm'], 'GET /settings/threshold': ['ver', 'aud', 'adm'], 'PUT /settings/threshold': ['adm'],
  'GET /dashboard/summary': ['ver', 'aud', 'adm'], 'POST /impact/simulate': ['aud', 'adm'], 'GET /impact/scenarios': ['aud', 'adm'], 'GET /evaluation/latest': ['aud', 'adm'],
  'GET /evaluation/evidence': ['aud', 'adm'], 'POST /cases/x/request-file': ['ver'], 'POST /cases/x/escalate': ['ver'], 'GET /file-requests': ['a', 'b', 'ver', 'aud'],
  'POST /file-requests/x/reply': ['a', 'b'], 'GET /file-requests/x/attachment': ['aud'], 'GET /home': ['a', 'b', 'ver', 'aud', 'adm'], 'GET /claims/tokenized': ['ver', 'aud', 'adm'], 'GET /reports/cases.csv': ['aud'], 'GET /export/evalkit': ['adm'], 'GET /audit': ['adm'], 'GET /audit/verify': ['adm'],
};
const openapiOps = () => {
  const ops = []; let cur = '';
  for (const line of fs.readFileSync(path.join(ROOT, 'docs', 'openapi.yaml'), 'utf8').split(/\r?\n/)) {
    const p = line.match(/^ {2}(\/\S+):\s*$/); if (p) cur = p[1].replace(/\{[^}]+\}/g, 'x');
    const m = line.match(/^ {4}(get|post|put|patch|delete):\s*$/); if (m && cur) ops.push(`${m[1].toUpperCase()} ${cur}`);
  }
  return ops;
};

test('RBAC: semua operasi di openapi.yaml punya aturan peran; peran di luar daftar 403, tanpa token 401', async () => {
  const ops = openapiOps();
  assert.ok(ops.length >= 24, `openapi terbaca ${ops.length} operasi`);
  assert.deepEqual(ops.filter((o) => !PUBLIC.includes(o) && !MATRIX[o]), [], 'operasi openapi tanpa tes peran');
  for (const [op, allowed] of Object.entries(MATRIX)) {
    const [method, p] = op.split(' ');
    const body = method === 'GET' ? undefined : {};
    assert.equal((await api(p, { method, body })).status, 401, `${op} tanpa token`);
    for (const role of ['a', 'ver', 'aud', 'adm']) {
      const r = await api(p, { method, body, token: tok[role] });
      assert.equal(r.status === 403, !allowed.includes(role), `${op} sebagai ${role} -> ${r.status}`);
    }
  }
});

test('header keamanan, CSP ketat, dan CORS tidak terbuka untuk origin asing', async () => {
  const r = await fetch(`${base}/`, { headers: { origin: 'https://evil.example' } });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('x-frame-options') ?? '', /DENY|SAMEORIGIN/i);
  assert.ok(r.headers.get('referrer-policy'));
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('x-powered-by'), null);
  const pre = await fetch(`${base}/api/v1/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
});

test('respons error tidak membocorkan NIK, nama, atau stack trace', async () => {
  const cases = [
    api('/claims', { method: 'POST', token: tok.a, body: claim({ patient_nik: '3273011234567890' }) }),
    api('/claims', { method: 'POST', token: tok.a, body: claim({ amount: -1 }) }),
    api('/claims', { method: 'POST', token: tok.a, headers: { 'content-type': 'application/json' }, body: undefined }),
    api('/verify', { method: 'POST', token: tok.ver, body: { participant_id: NIK, diagnosis_primary: NAME } }),
    api('/claims/upload', { method: 'POST', token: tok.a, text: `claim_ref,patient_nik,patient_name\nX,${NIK},${NAME}\n` }),
    api('/cases/%27%3B--', { token: tok.ver }),
  ];
  for (const r of await Promise.all(cases)) {
    assert.ok(!r.raw.includes(NIK) && !r.raw.includes(NAME) && !r.raw.includes('3273011234567890'), `PII di respons: ${r.raw.slice(0, 200)}`);
    assert.ok(!/\bat \S+ \(|node_modules|\.js:\d+/.test(r.raw), `stack trace di respons: ${r.raw.slice(0, 200)}`);
  }
  assert.equal((await api('/claims', { method: 'POST', token: tok.a, body: { ...claim(), role: 'admin' } })).status, 400, 'mass-assignment');
});

test('batas input: JSON besar ditolak 413, unggahan non-CSV ditolak, CSV tanpa baris ditolak', async () => {
  assert.equal((await api('/claims', { method: 'POST', token: tok.a, body: { ...claim(), patient_name: 'x'.repeat(200000) } })).status, 413);
  assert.equal((await api('/claims/upload', { method: 'POST', token: tok.a, body: { csv: 'x' } })).status, 415);
  assert.equal((await api('/claims/upload', { method: 'POST', token: tok.a, text: 'claim_ref\n' })).status, 400);
});

test('layanan internal menolak tanpa kunci atau kunci salah (perbandingan timing-safe, panjang beda ikut ditolak)', async () => {
  for (const [name, port, route] of [['privacy', 5482, 'audit'], ['claims', 5483, 'claims'], ['fraud', 5484, 'cases'], ['notify', 5485, 'notifications'], ['auth', 5481, 'demo-users']]) {
    for (const key of [undefined, 'salah', KEY.slice(0, -1), `${KEY}x`, KEY.replace(/x/g, 'y')]) {
      const r = await fetch(`http://127.0.0.1:${port}/v1/${route}`, { headers: key ? { 'x-internal-key': key } : {} });
      assert.equal(r.status, 401, `${name} dengan kunci ${key ?? '(kosong)'} -> ${r.status}`);
    }
  }
});

test('kata sandi tidak pernah dikembalikan di respons login, dan token tidak memuat kata sandi', async () => {
  const r = await api('/auth/login', { method: 'POST', body: { username: 'auditor', password: 'demo-auditor' } });
  assert.equal(r.status, 200); assert.ok(!r.raw.includes('demo-auditor'));
  const payload = JSON.parse(Buffer.from(r.json.token.split('.')[1], 'base64url').toString());
  assert.ok(!JSON.stringify(payload).includes('demo-'));
  assert.ok(payload.exp - payload.iat <= 3600, 'JWT berumur pendek');
});

test('rate limit: login gagal beruntun -> 429; /verify melewati batas -> 429', async () => {
  let got = null;
  for (let i = 1; i <= 12; i += 1) { if ((await api('/auth/login', { method: 'POST', body: { username: 'rs.melati', password: `salah-${i}` } })).status === 429) { got = i; break; } }
  assert.ok(got && got <= 7, `login brute-force 429 pada percobaan ${got}`);
  const v = { claim_id: 'RL-1', level: 'FKRTL', participant_id: 'PSTV01-aaaa0001', facility_id: 'RS-A', admit_date: '2026-10-01', discharge_date: '2026-10-05', diagnosis_primary: 'J18.9', procedures: ['87.44'], billed_amount: 6200000 };
  let hit = null;
  for (let i = 1; i <= 8; i += 1) { if ((await api('/verify', { method: 'POST', token: tok.ver, body: { ...v, claim_id: `RL-${i}` } })).status === 429) { hit = i; break; } }
  assert.ok(hit && hit <= 6, `/verify 429 pada permintaan ${hit}`);
});

