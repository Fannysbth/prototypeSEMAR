// Evaluasi sumber data kedua: dataset Kaggle (klaim Medicare AS 2009, label per PENYEDIA). Data publik non-BPJS.
// Penyedia uji tidak pernah terlihat saat latih (lipatan per penyedia). Ekspor eval-kit: entity_id = faskes_id, group_id = State.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../shared/config.js';
import { parseCsv, toCsv } from '../../shared/csv.js';

const mlDir = path.join(ROOT, 'services', 'ml');
const mapped = path.join(ROOT, 'data', 'kaggle-mapped');
const mlPython = () => ['.venv/Scripts/python.exe', '.venv/bin/python'].map((p) => path.join(mlDir, p)).find((p) => fs.existsSync(p)) ?? process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

// State = modus State beneficiary pada klaim penyedia; stratum = rawat inap dominan atau rawat jalan dominan.
export function providerGroups() {
  const state = new Map(parseCsv(fs.readFileSync(path.join(mapped, 'peserta.csv'), 'utf8')).map((p) => [p.PSTV01, p.kab_kota.split('-')[0]]));
  const by = new Map();
  for (const c of parseCsv(fs.readFileSync(path.join(mapped, 'fkrtl.csv'), 'utf8'))) {
    const g = by.get(c.faskes_id) ?? { states: new Map(), ri: 0, n: 0 };
    const s = state.get(c.PSTV01) || 'NA';
    g.states.set(s, (g.states.get(s) ?? 0) + 1); g.n += 1; if (c.jenis_layanan === 'RI') g.ri += 1;
    by.set(c.faskes_id, g);
  }
  return [...by].map(([faskes_id, g]) => ({
    faskes_id, group_id: `State-${[...g.states].sort((a, b) => b[1] - a[1])[0][0]}`, stratum: g.ri / g.n > 0.5 ? 'RI-dominan' : 'RJ-dominan',
  }));
}

export function runKaggleEval({ outDir: outArg, log = () => {} }) {
  let outDir = outArg;
  if (!fs.existsSync(path.join(mapped, 'fkrtl.csv'))) return { ran: false, reason: 'data/kaggle-mapped/ belum ada. Jalankan npm run import-kaggle.' };
  const tokenized = path.join(mlDir, 'data', 'claims_tokenized.csv');
  if (!fs.existsSync(tokenized)) {
    log('  menokenisasi data Kaggle (npm run ml:train)...');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ml-train.js')], { stdio: 'inherit' });
    if (r.status !== 0) return { ran: false, reason: 'ml:train gagal; periksa dependensi Python (services/ml/requirements.txt)' };
  }
  outDir = path.resolve(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const groups = path.join(outDir, 'groups.csv');
  fs.writeFileSync(groups, toCsv(providerGroups(), ['faskes_id', 'group_id', 'stratum']));
  const r = spawnSync(mlPython(), [path.join(mlDir, 'evaluate_kaggle.py'), tokenized, path.join(mlDir, 'data', 'truth_provider.csv'), groups, outDir], { cwd: mlDir, encoding: 'utf8' });
  fs.rmSync(groups, { force: true });
  if (r.status !== 0) return { ran: false, reason: `evaluasi Python gagal: ${(r.stderr || '').slice(-400)}` };
  const ablation = JSON.parse(fs.readFileSync(path.join(outDir, 'ablation.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'ml-metrics.json'), 'utf8'));
  return { ran: true, ...ablation, n_klaim: meta.n_klaim, versi_model: meta.versi, fitur_dilewati: meta.fitur_dilewati };
}

const f = (s) => (s ? `${(s.mean * 100).toFixed(1)}% ± ${(s.sd * 100).toFixed(1)}` : '-');
const VAR = { full: 'Model lengkap (ml per penyedia)', no_cross: 'Tanpa fitur lintas faskes', no_ml: 'Tanpa ML (aturan: tagihan dan lama rawat tinggi)', no_rules: 'Tanpa aturan' };

export function kaggleMd(k) {
  const head = '## Sumber data 2: Kaggle (klaim Medicare AS, data publik non-BPJS)\n\n';
  if (!k?.ran) return `${head}Tidak dijalankan: ${k?.reason ?? 'tidak ada data'}.\n`;
  const rows = Object.entries(VAR).map(([key, name]) => {
    const v = k.varian[key];
    return v ? `| ${name} | ${f(v.pr_auc)} | ${f(v.roc_auc)} | ${f(v.precision_at_k)} | ${f(v.recall_at_k)} |` : `| ${name} | tidak berlaku (detektor aturan bekerja per klaim lintas faskes, bukan per penyedia) | - | - | - |`;
  });
  return `${head}Evaluasi tingkat **penyedia**: ${k.n_penyedia} penyedia berlabel (${k.n_fraud} berlabel fraud, prevalensi ${(k.prevalensi * 100).toFixed(1)}%), ${k.n_klaim.toLocaleString('id-ID')} klaim. Lipatan acak per penyedia, diulang ${k.ulangan} kali; penyedia uji tidak pernah terlihat saat latih. Angka = rata-rata ± simpangan baku antar ulangan (poin persentase). Kapasitas review k = ${k.k_persen}% penyedia. Acak: PR-AUC = prevalensi (${(k.acak.pr_auc * 100).toFixed(1)}%), ROC-AUC = 50%.

| Varian | PR-AUC | ROC-AUC | precision@${k.k_persen}% | recall@${k.k_persen}% |
|---|---|---|---|---|
${rows.join('\n')}

Bacaan: selisih antara "Model lengkap" dan "Tanpa fitur lintas faskes" menunjukkan sumbangan fitur lintas faskes pada data ini. Diukur pada ${k.n_penyedia} penyedia sehingga simpangan antar ulangan lebar; jangan dibaca sebagai bukti kuat. Fitur dilewati karena datanya tidak ada: ${Object.keys(k.fitur_dilewati ?? {}).join(', ')}.

**Batasan sumber ini:** Kaggle adalah data **publik non-BPJS** (Medicare AS tahun 2009): kode ICD-9, nilai USD, label \`PotentialFraud\` per penyedia (bukan per klaim). Skor dan metrik hanya sah di tingkat penyedia. Ekspor eval-kit di \`reports/evalkit-kaggle/\` (entity_id = faskes_id, group_id = State); evidence card eval-kit hanya dibuat untuk sumber sintetis.
`;
}

export const kaggleReadme = (k) => (k?.ran
  ? `\n**Sumber 2: Kaggle (Medicare AS 2009, publik non-BPJS), tingkat penyedia, ${k.n_penyedia} penyedia, ${k.ulangan}x lipatan per penyedia:** PR-AUC ${f(k.varian.full.pr_auc)} (acak ${(k.acak.pr_auc * 100).toFixed(1)}%), ROC-AUC ${f(k.varian.full.roc_auc)}, precision@${k.k_persen}% ${f(k.varian.full.precision_at_k)}, recall@${k.k_persen}% ${f(k.varian.full.recall_at_k)}. Tanpa fitur lintas faskes: PR-AUC ${f(k.varian.no_cross.pr_auc)}. Aturan sederhana tanpa ML: PR-AUC ${f(k.varian.no_ml.pr_auc)}. Detail: \`reports/evaluation.md\`.\n`
  : `\n**Sumber 2: Kaggle** tidak dijalankan pada evaluasi terakhir (${k?.reason ?? 'tidak ada data'}).\n`);
