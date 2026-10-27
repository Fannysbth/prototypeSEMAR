// Generator data SINTETIS untuk unggah CSV: node scripts/generate-data --peserta 5000 --seed 42 --out data/synthetic
// Memakai shared/synthetic.js (NIK berawalan 9999). Menghasilkan claims.csv dan truth.csv (label modus untuk evaluasi).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDataset } from '../../shared/synthetic.js';
import { toCsv } from '../../shared/csv.js';

export const CLAIM_COLUMNS = ['facility_id', 'patient_nik', 'patient_name', 'phone', 'birth_date', 'record_number', 'diagnosis_code', 'procedure_code', 'claim_type', 'admit_date', 'length_of_stay', 'amount'];

export function generateDataset({ peserta = 5000, seed = 42 } = {}) {
  const items = buildDataset({ seed, normal: peserta, fraud: true });
  const claims = items.map((i) => ({ facility_id: i.facility_id, ...i.claim }));
  const truth = items.map((i, n) => ({ row: n + 2, patient_nik: i.claim.patient_nik, is_fraud: i.label.fraud ? 1 : 0, modus: i.label.modus ?? '' }));
  return { items, claimsCsv: toCsv(claims, CLAIM_COLUMNS), truthCsv: toCsv(truth, ['row', 'patient_nik', 'is_fraud', 'modus']) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
  const out = path.resolve(arg('out', 'data/synthetic'));
  const { items, claimsCsv, truthCsv } = generateDataset({ peserta: Number(arg('peserta', 5000)), seed: Number(arg('seed', 42)) });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'claims.csv'), claimsCsv);
  fs.writeFileSync(path.join(out, 'truth.csv'), truthCsv);
  console.log(`${items.length} klaim sintetis ditulis ke ${out}`);
}
