// node scripts/import-kaggle [--sample N|all] [--seed 42] [--in data/kaggle] [--out data/kaggle-mapped]
// Membaca CSV Train_* lalu menulis fkrtl.csv, peserta.csv, diag_sekunder.csv, truth_provider.csv, dan reports/data-card-kaggle.md.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/config.js';
import { parseCsv, toCsv } from '../../shared/csv.js';
import { mapKaggle, sampleProviders } from './map.js';
import { dataCard } from './data-card.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const inDir = path.resolve(ROOT, args.in ?? 'data/kaggle');
const outDir = path.resolve(ROOT, args.out ?? 'data/kaggle-mapped');
const sample = args.sample === 'all' ? Infinity : Number(args.sample ?? 300);

const read = (prefix) => {
  const f = fs.readdirSync(inDir).find((n) => n.startsWith(prefix) && n.endsWith('.csv'));
  if (!f) throw new Error(`File ${prefix}* tidak ada di ${inDir}`);
  return parseCsv(fs.readFileSync(path.join(inDir, f), 'utf8'));
};
const providersOf = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.BeneID)) m.set(r.BeneID, new Set()); m.get(r.BeneID).add(r.Provider); } return m; };
const multiProvider = (rows) => [...providersOf(rows).values()].filter((s) => s.size > 1).length;

const labels = read('Train-').map((r) => ({ faskes_id: r.Provider, label: r.PotentialFraud }));
const inpatientAll = read('Train_Inpatientdata'); const outpatientAll = read('Train_Outpatientdata'); const bene = read('Train_Beneficiarydata');
const chosen = sampleProviders(labels, sample, Number(args.seed ?? 42));
const keep = new Set(chosen.map((c) => c.faskes_id));
const inpatient = inpatientAll.filter((r) => keep.has(r.Provider)); const outpatient = outpatientAll.filter((r) => keep.has(r.Provider));
const { fkrtl, peserta, diagSekunder } = mapKaggle({ bene, inpatient, outpatient });

const FKRTL_COLS = ['FKL02', 'PSTV01', 'faskes_id', 'jenis_faskes', 'kab_kota_faskes', 'tgl_masuk', 'tgl_pulang', 'jenis_layanan', 'diag_utama', 'prosedur', 'inacbg', 'kelas_rawat', 'FKL47', 'FKL48', 'faskes_perujuk', 'attending_physician'];
fs.mkdirSync(outDir, { recursive: true });
const write = (name, rows, cols) => fs.writeFileSync(path.join(outDir, name), toCsv(rows, cols));
write('fkrtl.csv', fkrtl, FKRTL_COLS);
write('peserta.csv', peserta, ['PSTV01', 'PSTV02', 'nik', 'nama', 'tgl_lahir', 'jenis_kelamin', 'kab_kota', 'segmen', 'PSTV15']);
write('diag_sekunder.csv', diagSekunder, ['id_kunjungan', 'kode_icd10']);
write('truth_provider.csv', chosen.map((c) => ({ faskes_id: c.faskes_id, label: c.label === 'Yes' ? 1 : 0 })), ['faskes_id', 'label']);

const all = [...inpatientAll, ...outpatientAll]; const sub = [...inpatient, ...outpatient];
const stat = (rows, lab, ben) => ({ claims: rows.length, providers: lab.length, fraudProviders: lab.filter((l) => l.label === 'Yes').length, benes: ben, multiProviderBenes: multiProvider(rows) });
const full = stat(all, labels, new Set(all.map((r) => r.BeneID)).size);
const subset = stat(sub, chosen, new Set(sub.map((r) => r.BeneID)).size);
const mapped = { inpatient: inpatient.length, outpatient: outpatient.length };
fs.writeFileSync(path.join(ROOT, 'reports', 'data-card-kaggle.md'), dataCard({ full, subset, mapped, sample, seed: Number(args.seed ?? 42) }));
console.log(`Selesai: ${fkrtl.length} klaim, ${chosen.length} penyedia, ${peserta.length} peserta -> ${path.relative(ROOT, outDir)}`);
