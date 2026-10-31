// npm run demo:reset : kosongkan data lokal (dan skema Postgres bila DATABASE_URL diisi), buat data sintetis seed 42
// dan data latih model ml. Setelah ini: npm start (layanan ml melatih model dari data latih saat start).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../shared/config.js';
import { dropSchemas } from '../shared/store.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(dir, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`${script} gagal`); process.exit(r.status ?? 1); }
};
const config = getConfig();
// Mode Postgres per zona (DATABASE_URL_ADMIN diisi): kosongkan DB, 4 akun demo, impor data, latih ML (lihat scripts/seed.js).
if (process.env.DATABASE_URL_ADMIN) {
  const r = spawnSync(process.execPath, [path.join(dir, 'seed.js'), '--reset', ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
run('reset.js');
if (config.store.driver === 'postgres') {
  await dropSchemas(config.store.databaseUrl, ['privacy', 'claims', 'fraud', 'notify', 'gateway']);
  console.log('Skema Postgres samar_* dikosongkan.');
}
run('generate-data/index.js', '--peserta', '5000', '--seed', '42');
run('build-training-set.js');
run('build-demo-batch.js');
// Model Kaggle hanya dilatih bila hasil impor ada (npm run import-kaggle); tanpa itu layanan ml memakai model sintetis.
if (fs.existsSync(path.join(dir, '..', 'data', 'kaggle-mapped', 'fkrtl.csv'))) run('ml-train.js');
console.log('\nSiap. Jalankan npm start, lalu unggah demo/fkrtl_batch_november.csv (login faskes/verifikator).');
