// Menghapus data lokal (folder data/, kecuali secret) dan - dengan --drop-schemas - skema Postgres/Neon SAMAR.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { getConfig } from '../shared/config.js';
import { dropSchemas } from '../shared/store.js';

const config = getConfig();
if (fs.existsSync(config.store.dataDir)) {
  for (const f of fs.readdirSync(config.store.dataDir)) {
    // Dataset Kaggle mentah dan hasil pemetaannya bukan data aplikasi dan tidak bisa dibuat ulang tanpa unduh manual.
    if (f === '.secrets.json' || f === 'kaggle' || f === 'kaggle-mapped') continue;
    fs.rmSync(path.join(config.store.dataDir, f), { recursive: true, force: true });
  }
  console.log(`Data lokal dihapus: ${config.store.dataDir}`);
} else console.log('Tidak ada data lokal.');

if (process.argv.includes('--drop-schemas')) {
  if (!config.store.databaseUrl) { console.error('DATABASE_URL tidak diset.'); process.exit(1); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('Ini akan MENGHAPUS schema samar_* di database Neon Anda. Ketik YA untuk lanjut: ');
  rl.close();
  if (a.trim() !== 'YA') { console.log('Dibatalkan.'); process.exit(0); }
  await dropSchemas(config.store.databaseUrl, ['privacy', 'claims', 'fraud', 'notify', 'gateway']);
  console.log('Schema samar_* dihapus.');
}
