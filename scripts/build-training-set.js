// Membuat data latih layanan ml dari data SINTETIS (seed berbeda dari data demo): fitur lintas-faskes per klaim + label.
// Keluaran: services/ml/data/train.csv. Fitur dihitung dengan kode yang sama dengan produksi (services/fraud/engine.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../shared/store.js';
import { generateDataset } from './generate-data/index.js';
import { FEATURE_NAMES, buildObservation, extractFeatures, loadContext } from '../services/fraud/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'services', 'ml', 'data', 'train.csv');
const { items, truth } = generateDataset({ peserta: 3000, seed: 7, fraudRate: 0.03 });
const col = await (await createStore({ driver: 'memory', namespace: 'train' })).collection('obs');

const lines = [['claim_ref', 'admit_date', 'label', 'modus', 'holdout', ...FEATURE_NAMES].join(',')];
for (const [i, it] of items.entries()) {
  const obs = buildObservation({ claim_id: truth[i].claim_ref, facility_id: it.facility_id, fraud_ref: it.claim.patient_nik, ...it.claim });
  const feats = extractFeatures(obs, await loadContext(col, obs));
  await col.put(obs.claim_id, obs);
  lines.push([truth[i].claim_ref, it.claim.admit_date, truth[i].label, truth[i].modus, truth[i].holdout, ...feats.map((f) => +f.toFixed(4))].join(','));
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`${items.length} baris data latih -> ${out}`);
