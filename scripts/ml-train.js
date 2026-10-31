// npm run ml:train : latih model ml dari data Kaggle hasil impor (npm run import-kaggle).
// BeneID ditokenisasi di sini (skrip operator di zona gateway) SEBELUM masuk services/ml/data; layanan ml hanya melihat token.
// Umpan balik verifikator (TERKONFIRMASI = 1, DITOLAK_FALSE_POSITIVE = 0) diambil dari layanan fraud bila hidup.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, getConfig } from '../shared/config.js';
import { parseCsv, toCsv } from '../shared/csv.js';

const config = getConfig();
const mapped = path.join(ROOT, 'data', 'kaggle-mapped');
const out = path.join(ROOT, 'services', 'ml', 'data');
const need = (f) => { const p = path.join(mapped, f); if (!fs.existsSync(p)) { console.error(`${f} tidak ada. Jalankan npm run import-kaggle dulu.`); process.exit(1); } return p; };

const key = crypto.createHmac('sha256', config.secrets.HMAC_MASTER_KEY).update('samar-ml-train-token-v1').digest();
const tokenOf = (beneId) => `PSE_KGL_${crypto.createHmac('sha256', key).update(beneId).digest('hex').slice(0, 20).toUpperCase()}`;

const secondary = new Map();
for (const r of parseCsv(fs.readFileSync(need('diag_sekunder.csv'), 'utf8'))) secondary.set(r.id_kunjungan, (secondary.get(r.id_kunjungan) ?? 0) + 1);
const rows = parseCsv(fs.readFileSync(need('fkrtl.csv'), 'utf8')).map((r) => ({
  subject_token: tokenOf(r.PSTV01), faskes_id: r.faskes_id, jenis_layanan: r.jenis_layanan, tgl_masuk: r.tgl_masuk, tgl_pulang: r.tgl_pulang,
  diag_utama: r.diag_utama, n_diag: (r.diag_utama ? 1 : 0) + (secondary.get(r.FKL02) ?? 0), prosedur: r.prosedur, inacbg: r.inacbg, FKL47: r.FKL47, attending_physician: r.attending_physician,
}));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'claims_tokenized.csv'), toCsv(rows, Object.keys(rows[0])));
fs.copyFileSync(need('truth_provider.csv'), path.join(out, 'truth_provider.csv'));
console.log(`${rows.length} klaim ter-token -> services/ml/data/claims_tokenized.csv`);

const headers = { 'content-type': 'application/json', 'x-internal-key': config.secrets.INTERNAL_API_KEY };
let feedback = [];
try {
  const res = await fetch(`${config.urls.fraud}/v1/feedback`, { headers, signal: AbortSignal.timeout(3000) });
  if (res.ok) feedback = (await res.json()).items;
} catch { /* fraud tidak hidup: latih tanpa umpan balik */ }
console.log(`Umpan balik verifikator: ${feedback.length} penyedia`);

let trained = false;
try {
  const res = await fetch(`${config.urls.ml}/train`, { method: 'POST', headers, body: JSON.stringify({ feedback }), signal: AbortSignal.timeout(900000) });
  if (res.ok) { const j = await res.json(); console.log(`Layanan ml melatih ulang: ${j.version}`); trained = true; } else console.error(`ml /train ${res.status}: ${await res.text()}`);
} catch { /* ml tidak hidup: latih lewat CLI */ }
if (!trained) {
  const py = process.env.PYTHON || 'python';
  const r = spawnSync(py, [path.join(ROOT, 'services', 'ml', 'train_cli.py')], { input: JSON.stringify(feedback), stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error('Pelatihan gagal. Pastikan dependensi: pip install -r services/ml/requirements.txt (atur PYTHON bila perlu)'); process.exit(r.status ?? 1); }
}
console.log('Metrik: reports/ml-metrics.json');
