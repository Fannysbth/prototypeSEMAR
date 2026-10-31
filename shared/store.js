// Penyimpanan dokumen generik dengan 3 driver yang API-nya SAMA:
//   memory   : tanpa persistensi (dipakai tes & evaluasi)
//   file     : snapshot JSON di folder data/ (default saat tidak ada DATABASE_URL -> nol-setup)
//   postgres : Neon / Postgres apapun (otomatis dipakai jika DATABASE_URL diisi)
// Prinsip "database per layanan": tiap layanan memakai namespace sendiri
// (schema Postgres terpisah: samar_privacy, samar_claims, samar_fraud, ...).
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;
const assertName = (n) => {
  if (!NAME_RE.test(n)) throw new Error(`Nama tidak valid: ${n}`);
  return n;
};

// ---------- filter in-memory (semantik disamakan dengan SQL di bawah) ----------
function matches(doc, f = {}) {
  for (const [k, v] of Object.entries(f.eq || {})) {
    if (v === null || v === undefined) { if (doc[k] != null) return false; } else if (doc[k] == null || String(doc[k]) !== String(v)) return false;
  }
  for (const [k, v] of Object.entries(f.ne || {})) {
    if (doc[k] != null && String(doc[k]) === String(v)) return false;
  }
  for (const [k, vals] of Object.entries(f.in || {})) {
    if (doc[k] == null || !vals.map(String).includes(String(doc[k]))) return false;
  }
  for (const [k, v] of Object.entries(f.gte || {})) { if (!(Number(doc[k]) >= Number(v))) return false; }
  for (const [k, v] of Object.entries(f.lte || {})) { if (!(Number(doc[k]) <= Number(v))) return false; }
  return true;
}

function sortAndLimit(rows, { orderBy, dir = 'desc', limit } = {}) {
  let out = rows;
  if (orderBy) {
    const sign = dir === 'asc' ? 1 : -1;
    out = [...rows].sort((a, b) => {
      const x = Number(a[orderBy]); const y = Number(b[orderBy]);
      if (Number.isNaN(x) && Number.isNaN(y)) return 0;
      if (Number.isNaN(x)) return 1;
      if (Number.isNaN(y)) return -1;
      return (x - y) * sign;
    });
  }
  return limit ? out.slice(0, limit) : out;
}

// ---------- memory / file ----------
class MemoryCollection {
  constructor(onChange) { this.map = new Map(); this.onChange = onChange; }
  async put(id, doc) { this.map.set(id, structuredClone({ ...doc, id })); this.onChange(); }
  async insertIfAbsent(id, doc) {
    if (this.map.has(id)) return false;
    this.map.set(id, structuredClone({ ...doc, id }));
    this.onChange();
    return true;
  }
  async get(id) { const d = this.map.get(id); return d ? structuredClone(d) : null; }
  async update(id, patch) {
    const d = this.map.get(id);
    if (!d) return null;
    const next = { ...d, ...structuredClone(patch), id };
    this.map.set(id, next);
    this.onChange();
    return structuredClone(next);
  }
  async find(filter, opts) {
    const rows = [];
    for (const d of this.map.values()) if (matches(d, filter)) rows.push(d);
    return structuredClone(sortAndLimit(rows, opts));
  }
  async count(filter) {
    let n = 0;
    for (const d of this.map.values()) if (matches(d, filter)) n += 1;
    return n;
  }
  async delete(id) { const r = this.map.delete(id); if (r) this.onChange(); return r; }
  async clear() { this.map.clear(); this.onChange(); }
  dump() { return Object.fromEntries(this.map); }
  load(obj) { this.map = new Map(Object.entries(obj)); }
}

function createMemoryStore({ driver, namespace, dataDir }) {
  const cols = new Map();
  const file = driver === 'file' ? path.join(dataDir, `${namespace}.json`) : null;
  let saved = {};
  if (file && fs.existsSync(file)) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { saved = {}; }
  }
  let timer = null;
  const flush = () => {
    if (!file) return;
    clearTimeout(timer); timer = null;
    fs.mkdirSync(dataDir, { recursive: true });
    const snapshot = {};
    for (const [n, c] of cols) snapshot[n] = c.dump();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(snapshot));
    fs.renameSync(`${file}.tmp`, file);
  };
  const schedule = () => {
    if (!file || timer) return;
    timer = setTimeout(flush, 200);
    timer.unref?.();
  };
  return {
    driver,
    async collection(name) {
      assertName(name);
      if (!cols.has(name)) {
        const c = new MemoryCollection(schedule);
        if (saved[name]) c.load(saved[name]);
        cols.set(name, c);
      }
      return cols.get(name);
    },
    async ping() { return true; },
    async close() { flush(); },
  };
}

// ---------- postgres (Neon) ----------
function buildWhere(filter = {}, params) {
  const clauses = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  for (const [k, v] of Object.entries(filter.eq || {})) {
    assertName(k);
    clauses.push(v === null || v === undefined ? `doc->>'${k}' IS NULL` : `doc->>'${k}' = ${add(String(v))}`);
  }
  for (const [k, v] of Object.entries(filter.ne || {})) {
    assertName(k);
    clauses.push(`doc->>'${k}' IS DISTINCT FROM ${add(String(v))}`);
  }
  for (const [k, vals] of Object.entries(filter.in || {})) {
    assertName(k);
    clauses.push(`doc->>'${k}' = ANY(${add(vals.map(String))}::text[])`);
  }
  for (const [k, v] of Object.entries(filter.gte || {})) {
    assertName(k);
    clauses.push(`(doc->>'${k}')::numeric >= ${add(Number(v))}::numeric`);
  }
  for (const [k, v] of Object.entries(filter.lte || {})) {
    assertName(k);
    clauses.push(`(doc->>'${k}')::numeric <= ${add(Number(v))}::numeric`);
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

async function withRetry(fn, tries = 5, delayMs = 1500) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try { return await fn(); } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

// Zona data (db/migrations/001_zones.sql): privacy dan gateway di vault, claims/fraud/notify di analytics.
// Namespace lain (mis. tes) tetap memakai skema samar_<namespace>. Koleksi {schema, table, managed, appendOnly}
// dibuat oleh migrasi dan hanya boleh INSERT lewat peran layanan (audit_log).
export const ZONE_SCHEMA = { privacy: 'vault', gateway: 'vault', claims: 'analytics', fraud: 'analytics', notify: 'analytics' };

async function createPostgresStore({ namespace, databaseUrl, logger }) {
  const { default: pg } = await import('pg');
  const needsSsl = /neon\.tech|sslmode=(require|verify)/.test(databaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 6,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
    ...(needsSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  pool.on('error', (e) => logger?.warn('pool error', { message: e.message }));
  // Neon bisa "tidur" saat idle; koneksi pertama kadang butuh beberapa detik -> retry.
  await withRetry(() => pool.query('SELECT 1'));
  const zone = ZONE_SCHEMA[assertName(namespace)];
  const schema = zone ?? `samar_${namespace}`;
  if (!zone) await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); // skema zona dibuat migrasi; peran layanan tidak boleh membuat skema

  return {
    driver: 'postgres',
    async collection(name, { indexes = [], numericIndexes = [], schema: onlySchema, table, managed = false, appendOnly = false } = {}) {
      assertName(name);
      const tname = table ?? (zone ? `${namespace}_${name}` : name);
      const tbl = `"${onlySchema ?? schema}"."${assertName(tname)}"`;
      if (!managed) {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${tbl} (id text PRIMARY KEY, doc jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
        for (const k of indexes) await pool.query(`CREATE INDEX IF NOT EXISTS "ix_${tname}_${assertName(k)}" ON ${tbl} ((doc->>'${k}'))`);
        for (const k of numericIndexes) await pool.query(`CREATE INDEX IF NOT EXISTS "ixn_${tname}_${assertName(k)}" ON ${tbl} (((doc->>'${k}')::numeric))`);
      }
      const withId = (id, doc) => JSON.stringify({ ...doc, id });
      return {
        async put(id, doc) {
          if (appendOnly) { await pool.query(`INSERT INTO ${tbl} (id, doc) VALUES ($1, $2::jsonb)`, [id, withId(id, doc)]); return; }
          await pool.query(`INSERT INTO ${tbl} (id, doc) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`, [id, withId(id, doc)]);
        },
        async insertIfAbsent(id, doc) {
          const r = await pool.query(`INSERT INTO ${tbl} (id, doc) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`, [id, withId(id, doc)]);
          return r.rowCount === 1;
        },
        async get(id) {
          const r = await pool.query(`SELECT doc FROM ${tbl} WHERE id = $1`, [id]);
          return r.rows[0]?.doc ?? null;
        },
        async update(id, patch) {
          const r = await pool.query(`UPDATE ${tbl} SET doc = doc || $2::jsonb WHERE id = $1 RETURNING doc`, [id, JSON.stringify(patch)]);
          return r.rows[0]?.doc ?? null;
        },
        async find(filter, { orderBy, dir = 'desc', limit } = {}) {
          const params = [];
          const where = buildWhere(filter, params);
          const order = orderBy ? `ORDER BY (doc->>'${assertName(orderBy)}')::numeric ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST` : '';
          const lim = limit ? `LIMIT ${Math.max(1, Math.floor(Number(limit)))}` : '';
          const r = await pool.query(`SELECT doc FROM ${tbl} ${where} ${order} ${lim}`, params);
          return r.rows.map((x) => x.doc);
        },
        async count(filter) {
          const params = [];
          const r = await pool.query(`SELECT count(*)::int AS n FROM ${tbl} ${buildWhere(filter, params)}`, params);
          return r.rows[0].n;
        },
        async delete(id) { return (await pool.query(`DELETE FROM ${tbl} WHERE id = $1`, [id])).rowCount === 1; },
        async clear() { await pool.query(`DELETE FROM ${tbl}`); },
      };
    },
    async ping() { await pool.query('SELECT 1'); return true; },
    async close() { await pool.end(); },
  };
}

export async function createStore({ driver, namespace, dataDir, databaseUrl, logger }) {
  assertName(namespace);
  if (driver === 'postgres') return createPostgresStore({ namespace, databaseUrl, logger });
  if (driver === 'memory' || driver === 'file') return createMemoryStore({ driver, namespace, dataDir });
  throw new Error(`Driver penyimpanan tidak dikenal: ${driver}`);
}

export async function dropSchemas(databaseUrl, namespaces) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, ...(/neon\.tech|sslmode=/.test(databaseUrl) ? { ssl: { rejectUnauthorized: true } } : {}) });
  try {
    for (const ns of namespaces) await pool.query(`DROP SCHEMA IF EXISTS "${ZONE_SCHEMA[assertName(ns)] ?? `samar_${ns}`}" CASCADE`);
  } finally { await pool.end(); }
}
