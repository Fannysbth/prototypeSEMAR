// `npm start` -> menyalakan seluruh microservice + UI dalam satu perintah.
import { getConfig } from '../shared/config.js';
import { startStack } from './stack.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node.js ${process.versions.node} terlalu lama. Dibutuhkan Node 20 atau lebih baru (https://nodejs.org).`);
  process.exit(1);
}

let config;
try { config = getConfig(); } catch (err) { console.error(`\nKonfigurasi bermasalah: ${err.message}\n`); process.exit(1); }

const storeLabel = { memory: 'MEMORY (data hilang saat berhenti)', file: 'FILE lokal (folder data/, tanpa database)', postgres: 'POSTGRES / NEON (DATABASE_URL terdeteksi)' }[config.store.driver];
console.log(`\n  SAMAR - prototipe Healthkathon 2026`);
console.log(`  Penyimpanan : ${storeLabel}`);
console.log(`  Mode        : ${config.isProd ? 'production' : 'development'}${config.demoMode ? ' + DEMO_MODE' : ''}${config.syntheticOnly ? ' + data sintetis saja' : ''}\n`);

let stack;
const shutdown = async () => { if (stack) await stack.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  stack = await startStack({ onCrash: (name, code) => { console.error(`\nLayanan "${name}" berhenti tak terduga (kode ${code}). Menghentikan semuanya.`); shutdown(); } });
} catch (err) {
  console.error(`\nGagal menyalakan sistem: ${err.message}\n`);
  process.exit(1);
}

const url = `http://localhost:${config.ports.gateway}`;
console.log(`\n  ============================================================`);
console.log(`   SIAP. Buka di browser:  ${url}`);
if (config.demoMode) {
  console.log(`   Akun demo (klik tombol di halaman login, atau ketik manual):`);
  console.log(`     faskes     : rs.melati / demo-melati  (juga rs.kenanga, rs.cempaka, rs.anggrek)`);
  console.log(`     verifikator: verifikator / demo-verifikator`);
}
console.log(`   Hentikan dengan Ctrl+C`);
console.log(`  ============================================================\n`);
