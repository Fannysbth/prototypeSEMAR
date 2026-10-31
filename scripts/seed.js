// npm run seed [-- --reset] [-- --source kaggle|synthetic] [-- --sample N]
// Mengisi database Postgres: migrasi, (opsional --reset: kosongkan DB), 4 akun demo (DEMO_MODE), unggah data lewat jalur
// unggah gateway (tokenisasi + deteksi), lalu latih ML. Default sumber: Kaggle 300 penyedia.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, getConfig } from '../shared/config.js';
import { startStack } from './stack.js';
import { resetDatabase, zoneUrls } from './pg-env.js';
import { migrate } from './migrate.js';
import { generateDataset } from './generate-data/index.js';

getConfig(); // memuat .env
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const source = opt('source', 'kaggle');
const sample = opt('sample', '300');
const admin = process.env.DATABASE_URL_ADMIN;
if (!admin) { console.error('Set DATABASE_URL_ADMIN (akun pemilik database; lihat .env.example).'); process.exit(1); }
if (!['kaggle', 'synthetic'].includes(source)) { console.error('--source harus kaggle atau synthetic'); process.exit(1); }

const run = (script, ...a) => { const r = spawnSync(process.execPath, [path.join(ROOT, script), ...a], { stdio: 'inherit', env: process.env }); if (r.status !== 0) { console.error(`${script} gagal`); process.exit(r.status ?? 1); } };

let zones;
if (args.includes('--reset')) { zones = await resetDatabase(admin); console.log('Database dikosongkan dan dimigrasi ulang.'); } else {
  const pw = { private: process.env.PRIVATE_DB_PASSWORD, token: process.env.TOKEN_DB_PASSWORD };
  if (!pw.private || !pw.token) { console.error('Set PRIVATE_DB_PASSWORD dan TOKEN_DB_PASSWORD, atau pakai --reset (sandi dev).'); process.exit(1); }
  await migrate({ adminUrl: admin, privatePassword: pw.private, tokenPassword: pw.token });
  zones = { STORE: 'postgres', DATABASE_URL: admin, ...zoneUrls(admin, pw) };
}

let csv; let query = '';
if (source === 'kaggle') {
  if (!fs.existsSync(path.join(ROOT, 'data', 'kaggle'))) { console.error('data/kaggle/ tidak ada. Unduh dataset Kaggle (lihat README).'); process.exit(1); }
  run('scripts/import-kaggle/index.js', '--sample', sample);
  csv = fs.readFileSync(path.join(ROOT, 'data', 'kaggle-mapped', 'fkrtl.csv'), 'utf8'); query = '?source=kaggle';
} else csv = generateDataset({ peserta: 5000, seed: 42 }).claimsCsv;

const stack = await startStack({ quiet: true, env: { ...zones, DEMO_MODE: process.env.DEMO_MODE || 'true', ML_ENABLED: 'false' } });
try {
  const call = async (p, init) => { const r = await fetch(stack.baseUrl + p, init); return r.json(); };
  const { token, user } = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'verifikator', password: 'demo-verifikator' }) });
  if (!token) throw new Error('Akun demo tidak tersedia (butuh DEMO_MODE=true)');
  console.log(`Akun demo siap: faskes, verifikator, auditor, admin (login sebagai ${user.role}).`);
  const t0 = Date.now();
  const r = await call(`/api/claims/upload${query}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv' }, body: csv });
  console.log(`Impor ${source}: ${r.total} baris, ${r.accepted} diterima, ${r.rejected} ditolak, ${r.cases} kasus (${Math.round((Date.now() - t0) / 1000)} detik).`);
} finally { await stack.stop(); }

if (source === 'kaggle') run('scripts/ml-train.js');
else console.log('Sumber sintetis: model ml dilatih dari services/ml/data/train.csv (npm run train-data).');
