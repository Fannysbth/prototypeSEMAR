// npm run audit:verify : periksa rantai hash audit_log (hash = sha256 hash_prev + isi baris). Keluar kode 1 bila rusak.
import pg from 'pg';
import { verifyChain } from '../services/privacy/chain.js';
import { getConfig } from '../shared/config.js';

const url = process.env.DATABASE_URL_PRIVACY || process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL || getConfig().store.databaseUrl;
if (!url) { console.error('Set DATABASE_URL_PRIVACY (atau DATABASE_URL_ADMIN).'); process.exit(1); }
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const rows = (await c.query("SELECT doc FROM audit.audit_log ORDER BY (doc->>'seq')::numeric")).rows.map((r) => r.doc);
  const r = verifyChain(rows);
  console.log(r.valid ? `Rantai audit utuh (${r.entries} entri).` : `Rantai audit RUSAK pada entri ke-${r.broken_at} dari ${r.entries}.`);
  process.exit(r.valid ? 0 : 1);
} finally { await c.end(); }
