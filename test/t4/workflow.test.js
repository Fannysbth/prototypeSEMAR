// T4: pemisahan peran. Verifikator tidak membuka identitas; ia meminta berkas ke faskes atau mengeskalasi ke auditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startStack } from '../../scripts/stack.js';
import { ROOT } from '../../shared/config.js';

const KEY = 't4-internal-key-'.padEnd(40, 'x');
let stack; let base; let caseId; let claimId;
const tok = {};
const api = async (p, { method = 'GET', body, token, text } = {}) => {
  const res = await fetch(`${base}/api/v1${p}`, { method, headers: { ...(text ? { 'content-type': 'text/csv' } : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: text ?? (body ? JSON.stringify(body) : undefined) });
  const raw = await res.text(); let json = null; try { json = JSON.parse(raw); } catch { /* bukan JSON */ }
  return { status: res.status, json, raw, headers: res.headers };
};
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;

test.before(async () => {
  stack = await startStack({ quiet: true, env: {
    STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test', ML_ENABLED: 'false', LLM_API_KEY: '',
    JWT_SECRET: 't4-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 't4-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5460', AUTH_PORT: '5461', PRIVACY_PORT: '5462', CLAIMS_PORT: '5463', FRAUD_PORT: '5464', NOTIFY_PORT: '5465', ML_PORT: '5466',
    RATE_LIMIT_PER_MIN: '100000', VERIFY_RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '100', REIDENTIFY_MAX_PER_HOUR: '50', REIDENTIFY_MAX_PER_DAY: '50',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', ML_URL: '', LOG_LEVEL: 'error',
  } });
  base = stack.baseUrl;
  for (const [k, u, p] of [['a', 'rs.melati', 'demo-melati'], ['b', 'rs.kenanga', 'demo-kenanga'], ['ver', 'verifikator', 'demo-verifikator'], ['aud', 'auditor', 'demo-auditor'], ['adm', 'admin', 'demo-admin']]) tok[k] = await login(u, p);
  const csv = fs.readFileSync(path.join(ROOT, 'demo', 'fkrtl_batch_november_RS-A.csv'), 'utf8');
  assert.equal((await api('/claims/upload', { method: 'POST', token: tok.a, text: csv })).status, 200);
  const cases = (await api('/cases', { token: tok.ver })).json.items;
  assert.ok(cases.length > 0);
  caseId = cases[0].case_id; claimId = cases[0].claim_id;
});
test.after(async () => { await stack?.stop(); });

const auditActions = async () => (await api('/audit?limit=300', { token: tok.adm })).json.items.map((a) => a.action);

test('verifikator tidak bisa membuka identitas; hanya auditor', async () => {
  const body = { reason: 'Saya verifikator ingin melihat identitas pasien ini' };
  assert.equal((await api(`/cases/${caseId}/reveal`, { method: 'POST', token: tok.ver, body })).status, 403);
});

test('minta berkas: status MENUNGGU_FASKES, tercatat di case_events dan audit; catatan ber-PII ditolak', async () => {
  const pii = await api(`/cases/${caseId}/request-file`, { method: 'POST', token: tok.ver, body: { note: 'Cek pasien NIK 9999123412341234 segera' } });
  assert.equal(pii.status, 400);
  const r = await api(`/cases/${caseId}/request-file`, { method: 'POST', token: tok.ver, body: { note: 'Mohon lampirkan resume medis untuk klaim ini' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.claim_id, claimId); assert.equal(r.json.status, 'MENUNGGU');
  const c = (await api(`/cases/${caseId}`, { token: tok.ver })).json;
  assert.equal(c.status, 'MENUNGGU_FASKES');
  assert.ok(c.events.some((e) => e.to_status === 'MENUNGGU_FASKES' && e.actor === 'verifikator'));
  assert.ok((await auditActions()).includes('FILE_REQUEST'));
});

test('faskes hanya melihat permintaan miliknya, tanpa skor atau modus', async () => {
  const mine = (await api('/file-requests', { token: tok.a })).json.items;
  assert.equal(mine.length, 1);
  assert.deepEqual(Object.keys(mine[0]).sort(), ['claim_id', 'created_ms', 'note', 'reply', 'request_id', 'status'].sort());
  assert.deepEqual((await api('/file-requests', { token: tok.b })).json.items, []);
  assert.equal((await api(`/file-requests/${mine[0].request_id}/reply`, { method: 'POST', token: tok.b, body: { note: 'Balasan dari faskes lain' } })).status, 404);
});

test('balasan faskes: catatan disaring PII, lampiran maks 200 KB, hanya auditor mengunduh lampiran', async () => {
  const id = (await api('/file-requests', { token: tok.a })).json.items[0].request_id;
  assert.equal((await api(`/file-requests/${id}/reply`, { method: 'POST', token: tok.a, body: { note: 'Pasien atas nama NIK 9999123412341234 dirawat' } })).status, 400);
  const big = Buffer.alloc(201 * 1024, 65).toString('base64');
  assert.equal((await api(`/file-requests/${id}/reply`, { method: 'POST', token: tok.a, body: { note: 'Lampiran terlalu besar', attachment: { name: 'resume.txt', content_base64: big } } })).status, 413);
  assert.equal((await api(`/file-requests/${id}/reply`, { method: 'POST', token: tok.a, body: { note: 'Lampiran berbahaya', attachment: { name: 'x.exe', content_base64: 'QUJD' } } })).status, 400);
  const ok = await api(`/file-requests/${id}/reply`, { method: 'POST', token: tok.a, body: { note: 'Resume terlampir, rawat inap 4 hari sesuai klaim', attachment: { name: 'resume.txt', content_base64: Buffer.from('Resume medis ringkas tanpa identitas').toString('base64') } } });
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'DIBALAS');
  assert.equal((await api(`/cases/${caseId}`, { token: tok.ver })).json.status, 'DITINJAU');
  const seen = (await api('/file-requests', { token: tok.ver })).json.items.find((x) => x.request_id === id);
  assert.equal(seen.reply.note, 'Resume terlampir, rawat inap 4 hari sesuai klaim');
  assert.equal(seen.reply.attachment.name, 'resume.txt'); assert.ok(!('content_base64' in seen.reply.attachment));
  assert.equal((await api(`/file-requests/${id}/attachment`, { token: tok.ver })).status, 403);
  const dl = await api(`/file-requests/${id}/attachment`, { token: tok.aud });
  assert.equal(dl.status, 200); assert.match(dl.raw, /Resume medis ringkas/);
  assert.ok((await auditActions()).includes('FILE_REPLY'));
});

test('eskalasi ke auditor: status ESKALASI, muncul di daftar auditor, tercatat; faskes tidak boleh', async () => {
  assert.equal((await api(`/cases/${caseId}/escalate`, { method: 'POST', token: tok.a, body: { note: 'Coba eskalasi dari faskes' } })).status, 403);
  assert.equal((await api(`/cases/${caseId}/request-file`, { method: 'POST', token: tok.a, body: { note: 'Faskes meminta berkas' } })).status, 403);
  const e = await api(`/cases/${caseId}/escalate`, { method: 'POST', token: tok.ver, body: { note: 'Perlu konfirmasi identitas peserta' } });
  assert.equal(e.status, 200); assert.equal(e.json.status, 'ESKALASI');
  const list = (await api('/cases?status=ESKALASI', { token: tok.aud })).json.items;
  assert.ok(list.some((c) => c.case_id === caseId));
  assert.ok((await auditActions()).includes('CASE_ESCALATE'));
  assert.ok((await api(`/cases/${caseId}`, { token: tok.aud })).json.events.some((x) => x.to_status === 'ESKALASI'));
});
