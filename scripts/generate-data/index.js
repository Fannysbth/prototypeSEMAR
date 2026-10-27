// Generator data SINTETIS: node scripts/generate-data --peserta 5000 --seed 42 --fraud-rate 0.03 --out data/synthetic
// Memakai shared/synthetic.js (NIK berawalan 9999; tidak ada data JKN riil). Keluaran:
//   claims.csv  : klaim siap unggah (kolom prototype, lihat config/column-map.json untuk padanan kode BPJS)
//   truth.csv   : label per klaim (modus fraud, excess_rupiah, hold-out) untuk evaluasi dan latih model
//   reports/data-card.md : parameter generator
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDataset } from '../../shared/synthetic.js';
import { REFERENCE } from '../../shared/reference.js';
import { toCsv } from '../../shared/csv.js';

export const CLAIM_COLUMNS = ['claim_ref', 'facility_id', 'patient_nik', 'patient_name', 'phone', 'birth_date', 'record_number', 'diagnosis_code', 'procedure_code', 'claim_type', 'admit_date', 'length_of_stay', 'amount'];
export const TRUTH_COLUMNS = ['claim_ref', 'label', 'modus', 'excess_rupiah', 'group', 'holdout'];
// Satu modus tidak dipakai melatih model supervised (uji generalisasi ke modus yang belum pernah dilihat).
export const HOLDOUT_MODUS = 'REPEAT_BILLING';
const FRAUD_CLAIMS_PER_SCALE = 70; // jumlah klaim berlabel fraud pada fraudScale = 1 (lihat groups di shared/synthetic.js)

// Rupiah berlebih per klaim berlabel fraud (estimasi generator, bukan tarif resmi).
export function excessRupiah(claim, modus) {
  const ref = REFERENCE[claim.diagnosis_code];
  if (modus === 'UPCODING' && ref) return Math.max(0, claim.amount - ref.tariff_median);
  if (modus === 'PROLONGED_LOS' && ref) return Math.round(claim.amount * Math.max(0, claim.length_of_stay - ref.expected_los) / claim.length_of_stay);
  if (modus === 'PROCEDURE_MISMATCH') return Math.round(claim.amount * 0.2);
  return claim.amount;
}

export function generateDataset({ peserta = 5000, seed = 42, fraudRate = 0.03, base = '2026-06-01', span = 80, difficulty = 'standard' } = {}) {
  const chronic = Math.round(peserta * 0.1);
  const normal = Math.round(peserta * 0.85);
  const fraudScale = (fraudRate * (normal * 1.2 + chronic * 4)) / FRAUD_CLAIMS_PER_SCALE;
  const items = buildDataset({ seed, normal, chronic, fraudScale, base, span, difficulty });
  const ref = (n) => `FKL-${String(n + 1).padStart(7, '0')}`;
  const claims = items.map((i, n) => ({ claim_ref: ref(n), facility_id: i.facility_id, ...i.claim }));
  const truth = items.map((i, n) => ({
    claim_ref: ref(n), label: i.label.fraud ? 1 : 0, modus: i.label.modus ?? '',
    excess_rupiah: i.label.fraud ? excessRupiah(i.claim, i.label.modus) : 0, group: i.label.group, holdout: i.label.modus === HOLDOUT_MODUS ? 1 : 0,
  }));
  return { items, claims, truth, claimsCsv: toCsv(claims, CLAIM_COLUMNS), truthCsv: toCsv(truth, TRUTH_COLUMNS), params: { peserta, seed, fraudRate, base, span, difficulty, chronic, normal, fraudScale: +fraudScale.toFixed(2) } };
}

function dataCard(params, n, nFraud) {
  return `# Data card (sintetis)

Dihasilkan oleh \`scripts/generate-data\`. Seluruh data sintetis; NIK berawalan 9999; tidak ada data peserta JKN riil.

| Parameter | Nilai |
|---|---|
| peserta (target) | ${params.peserta} |
| seed | ${params.seed} |
| fraud-rate (target, dari klaim wajar) | ${params.fraudRate} |
| tanggal dasar | ${params.base} (sebaran ~80 hari) |
| pasien wajar / pasien kronis (hard negative) | ${params.normal} / ${params.chronic} |
| pengali skenario fraud | ${params.fraudScale} |
| total klaim | ${n} |
| klaim berlabel fraud | ${nFraud} (${(100 * nFraud / n).toFixed(2)}%) |
| modus hold-out (tidak dipakai melatih model supervised) | ${HOLDOUT_MODUS} |

Batas: label berasal dari generator, bukan hasil audit BPJS. Metrik di data ini membuktikan mekanisme, bukan akurasi pada data riil.
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
  const out = path.resolve(arg('out', 'data/synthetic'));
  const d = generateDataset({ peserta: Number(arg('peserta', 5000)), seed: Number(arg('seed', 42)), fraudRate: Number(arg('fraud-rate', 0.03)) });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'claims.csv'), d.claimsCsv);
  fs.writeFileSync(path.join(out, 'truth.csv'), d.truthCsv);
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'data-card.md'), dataCard(d.params, d.items.length, d.truth.filter((t) => t.label).length));
  console.log(`${d.items.length} klaim sintetis (${d.truth.filter((t) => t.label).length} berlabel fraud) ditulis ke ${out}`);
}
