// Keamanan zona di Postgres: peran zona token tidak punya akses ke vault, audit_log hanya bisa ditambah,
// dan rantai hash audit terdeteksi rusak bila satu baris diubah. Butuh Postgres (docker compose up -d db).
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createStore } from '../../shared/store.js';
import { createPrivacyCore } from '../../services/privacy/core.js';
import { POLICY } from '../../services/privacy/policy.js';
import { verifyChain } from '../../services/privacy/chain.js';
import { resetDatabase, zoneUrls } from '../../scripts/pg-env.js';

const ADMIN = process.env.SAMAR_TEST_PG || process.env.TEST_DATABASE_URL || 'postgresql://samar:samar@127.0.0.1:5433/samar';
const reachable = await (async () => {
  const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 3000 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
})();
const opts = { skip: reachable ? false : 'Postgres tidak tersedia (jalankan: docker compose -f docker-compose.yml -f docker-compose.hostdb.yml up -d db)' };

const query = async (url, sql, params) => {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
};
const denied = (p) => assert.rejects(p, (e) => e.code === '42501');
let urls;
test.before(async () => { if (reachable) { await resetDatabase(ADMIN); urls = zoneUrls(ADMIN); } });

test('peran zona token gagal SELECT dari vault, dan sebaliknya zona pribadi tidak menyentuh analytics', opts, async () => {
  await query(ADMIN, "CREATE TABLE vault.contoh (id text PRIMARY KEY, doc jsonb); INSERT INTO vault.contoh VALUES ('1','{}')");
  await query(ADMIN, "CREATE TABLE analytics.contoh (id text PRIMARY KEY, doc jsonb); INSERT INTO analytics.contoh VALUES ('1','{}')");
  await denied(query(urls.DATABASE_URL_CLAIMS, 'SELECT * FROM vault.contoh'));
  await denied(query(urls.DATABASE_URL_FRAUD, 'SELECT * FROM vault.privacy_mappings'));
  await denied(query(urls.DATABASE_URL_NOTIFY, 'CREATE TABLE vault.baru (id int)'));
  await denied(query(urls.DATABASE_URL_PRIVACY, 'SELECT * FROM analytics.contoh'));
});

test('audit_log: zona token hanya INSERT, tanpa UPDATE/DELETE/SELECT; zona pribadi tanpa UPDATE/DELETE', opts, async () => {
  const doc = JSON.stringify({ seq: 1, action: 'X' });
  await query(urls.DATABASE_URL_CLAIMS, "INSERT INTO audit.audit_log (id, doc) VALUES ('t1', $1::jsonb)", [doc]);
  await denied(query(urls.DATABASE_URL_CLAIMS, 'SELECT * FROM audit.audit_log'));
  await denied(query(urls.DATABASE_URL_CLAIMS, "UPDATE audit.audit_log SET doc = '{}'"));
  await denied(query(urls.DATABASE_URL_CLAIMS, 'DELETE FROM audit.audit_log'));
  assert.equal((await query(urls.DATABASE_URL_PRIVACY, 'SELECT * FROM audit.audit_log')).rowCount, 1);
  await denied(query(urls.DATABASE_URL_PRIVACY, "UPDATE audit.audit_log SET doc = '{}'"));
  await denied(query(urls.DATABASE_URL_PRIVACY, 'DELETE FROM audit.audit_log'));
  await query(ADMIN, 'DELETE FROM audit.audit_log');
});

test('rantai hash audit terdeteksi rusak jika satu baris diubah di database', opts, async () => {
  const priv = await createStore({ driver: 'postgres', namespace: 'privacy', databaseUrl: urls.DATABASE_URL_PRIVACY });
  const audit = await priv.collection('audit', { schema: 'audit', table: 'audit_log', managed: true, appendOnly: true });
  const mem = await createStore({ driver: 'memory', namespace: 'x' });
  const core = createPrivacyCore({ mappings: await mem.collection('m'), audit, policy: POLICY, config: { secrets: { HMAC_MASTER_KEY: 'k'.repeat(40) }, tokenTtlSeconds: 2592000, reidentifyMaxPerHour: 9 } });
  try {
    for (const n of [1, 2, 3]) await core.recordEvent({ action: 'CASE_STATUS', actor: 'verifikator', role: 'verifier', target: `CASE-${n}`, reason: `BARU -> DITINJAU ${n}` });
    assert.equal((await core.verifyAudit()).valid, true);
    await query(ADMIN, "UPDATE audit.audit_log SET doc = jsonb_set(doc, '{reason}', '\"diubah\"') WHERE (doc->>'seq')::int = 2");
    const rows = (await query(ADMIN, "SELECT doc FROM audit.audit_log ORDER BY (doc->>'seq')::int")).rows.map((r) => r.doc);
    assert.deepEqual(verifyChain(rows), { valid: false, entries: 3, broken_at: 2 });
  } finally { await priv.close(); }
});
