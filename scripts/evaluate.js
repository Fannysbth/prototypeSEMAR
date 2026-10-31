// npm run evaluate: evaluasi terukur SAMAR.
//  1) deteksi offline: 3 seed x fraud rate 1%/3% x set standar/hard, split waktu, hold-out, ablasi (scripts/eval/offline.js)
//  2) sistem nyata: paritas baseline vs proposed, paparan PII, kinerja, /verify, unggah, keamanan (scripts/eval/stack-run.js)
//  3) laporan: reports/metrics.json, evaluation.md, data-card.md, evalkit/*.csv, evidence.html (eval-kit)
// Semua angka di README, dashboard, dan laporan diambil dari reports/metrics.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../shared/config.js';
import { buildDataset } from '../shared/synthetic.js';
import { runMode, SEED } from './eval/stack-run.js';
import { evalkitFiles, runGrid, SEEDS, FRAUD_RATES, CAPACITY } from './eval/offline.js';
import { HOLDOUT_MODUS, SPAN_DAYS, TRAIN_DAYS } from './eval/dataset.js';
import { CASE_SCORE } from './eval/score.js';
import { runKit } from './eval/kit.js';
import { dataCardMd, evaluationMd } from './eval/report.js';
import { renderReadme } from './render-readme.js';
import { kaggleMd, runKaggleEval } from './eval/kaggle.js';

const PESERTA = Number(process.env.EVAL_PESERTA || 4000);
const log = (m) => console.log(m);
const reports = path.join(ROOT, 'reports');
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(reports, rel)), { recursive: true }); fs.writeFileSync(path.join(reports, rel), text); };

const LIMITATIONS = [
  'Seluruh data sintetis. Label berasal dari generator, bukan hasil audit BPJS. Angka membuktikan mekanisme, bukan akurasi pada data JKN riil.',
  'Generator dan detektor ditulis oleh pihak yang sama (satu tim); detektor aturan dirancang untuk pola yang sama dengan generator. Hasil pada set standar cenderung terlalu optimistis; set hard dibuat untuk mengurangi, bukan menghilangkan, bias itu.',
  'Kapasitas review 1% klaim adalah asumsi, bukan data kapasitas verifikator BPJS. Pada fraud rate 3% recall@1% dibatasi kapasitas, bukan kualitas model.',
  'Jumlah klaim fraud di set uji kecil (puluhan per run), sehingga selang kepercayaan lebar; recall per modus dan modus hold-out dihitung dari gabungan 6 run dan tetap berbasis puluhan kasus.',
  'Latensi dan throughput diukur di satu mesin dengan penyimpanan memori dan tanpa LLM eksternal; angka absolut bergantung perangkat.',
  'Tarif referensi per diagnosis ilustratif, bukan INA-CBG resmi. Estimasi rupiah berlebih adalah estimasi generator, bukan angka audit.',
];

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(ROOT, 'services', 'ml', 'data', 'train.csv'))) spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-training-set.js')], { stdio: 'inherit' });

  log(`\n=== Bagian 1: deteksi offline (${SEEDS.length} seed x ${FRAUD_RATES.length} fraud rate x 2 tingkat, ${PESERTA} peserta/run) ===`);
  const offline = await runGrid({ peserta: PESERTA, log });

  log('\n=== Bagian 2: sistem nyata (baseline vs SAMAR) ===');
  const dataset = buildDataset({ seed: SEED });
  const baseline = await runMode('baseline', dataset);
  const proposed = await runMode('proposed', dataset);
  const identical = baseline.raw.filter((b, i) => b.score === proposed.raw[i].score && b.modi.join() === proposed.raw[i].modi.join()).length;
  const secRej = proposed.security.filter((t) => t.kind === 'reject');
  const functional = [...proposed.functional, { name: 'Mode baseline (pembanding) berjalan pada seluruh dataset', pass: baseline.detection.tp + baseline.detection.fp + baseline.detection.fn + baseline.detection.tn === dataset.length }];
  const ov = (a, b) => ((b - a) / a) * 100;
  const r1 = (n) => +n.toFixed(1);
  const stack = {
    dataset: { claims: dataset.length, fraud_labeled: dataset.filter((d) => d.label.fraud).length, seed: SEED },
    ml_ready: { baseline: !!baseline.ml_ready, proposed: !!proposed.ml_ready },
    detection: { baseline: baseline.detection, proposed: proposed.detection },
    parity: { identical, total: dataset.length, pct: (identical / dataset.length) * 100 },
    privacy: { baseline: baseline.privacy, proposed: proposed.privacy, note: 'Privacy Service menerima data mentah by design (satu-satunya titik, vault terenkripsi AES-256-GCM) dan tidak dihitung sebagai layanan hilir.' },
    performance: {
      baseline: baseline.performance, proposed: proposed.performance,
      overhead: { p95_abs_ms: r1(proposed.performance.p95_ms - baseline.performance.p95_ms), mean_pct: r1(ov(baseline.performance.mean_ms, proposed.performance.mean_ms)), p95_pct: r1(ov(baseline.performance.p95_ms, proposed.performance.p95_ms)), tps_pct: r1(ov(baseline.performance.tps, proposed.performance.tps)) },
      note: 'Satu mesin, penyimpanan memori, layanan ml aktif. Latensi absolut dengan Postgres lewat jaringan lebih tinggi.',
    },
    verify: proposed.verify, upload: proposed.upload,
    security: { total: secRej.length, rejected: secRej.filter((t) => t.pass).length, rejected_pct: r1((secRej.filter((t) => t.pass).length / secRej.length) * 100), tests: proposed.security },
    functional: { passed: functional.filter((t) => t.pass).length, total: functional.length, tests: functional },
  };

  log('\n=== Bagian 3: sumber data kedua, Kaggle (per penyedia, data publik non-BPJS) ===');
  const kaggle = runKaggleEval({ outDir: path.join(reports, 'evalkit-kaggle'), log });
  log(kaggle.ran ? `  Kaggle: PR-AUC ${kaggle.varian.full.pr_auc.mean}, tanpa lintas faskes ${kaggle.varian.no_cross.pr_auc.mean}, aturan saja ${kaggle.varian.no_ml.pr_auc.mean}` : `  Kaggle dilewati: ${kaggle.reason}`);

  log('\n=== Bagian 4: laporan dan eval-kit ===');
  const evidence = { ran: false, reason: 'belum dijalankan', limitations: [] };
  const kitRuns = [['standard', 'evalkit', 'evidence.html'], ['hard', 'evalkit-hard', 'evidence-hard.html']];
  for (const [difficulty, dir, html] of kitRuns) {
    const files = evalkitFiles(offline.primary[difficulty]);
    for (const [name, text] of Object.entries(files)) write(path.join(dir, name), text);
    const res = runKit({ evalkitDir: path.join(reports, dir), out: path.join(reports, html), seed: SEEDS[0] });
    log(`  eval-kit (${difficulty}): ${res.ran ? `${html} dibuat` : res.reason}`);
    if (difficulty === 'standard') Object.assign(evidence, res); else evidence.hard = { ran: res.ran, reason: res.reason, limitations: res.limitations };
    if (res.ran) write(`${html.replace('.html', '.md')}`, res.md);
  }

  const sat = offline.summary.standard.full.pr_auc?.mean >= 0.95;
  const metrics = {
    generated_at: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()} · ${os.cpus().length} CPU`,
    protocol: {
      seeds: SEEDS, fraud_rates: FRAUD_RATES, peserta: PESERTA, train_days: TRAIN_DAYS, span_days: SPAN_DAYS, capacity: CAPACITY, case_threshold: CASE_SCORE,
      holdout_modus: HOLDOUT_MODUS, bootstrap: { B: 200, unit: 'pasien (token)' }, difficulties: ['standard', 'hard'],
    },
    limitations: LIMITATIONS,
    detection: { ...offline, primary: undefined, saturation_note: sat ? 'PR-AUC rata-rata >= 0,95: ini dibaca sebagai bukti mekanisme (pola fraud di generator dan detektor sejalan), bukan akurasi pada data nyata. Lihat set hard.' : '' },
    impact_inputs: offline.impact_inputs,
    data_card: offline.runs,
    stack,
    // Dipisah per sumber: detection/stack/data_card = sintetis; kaggle = data publik non-BPJS (per penyedia)
    sources: { synthetic: ['detection', 'stack', 'data_card'], kaggle: ['kaggle'] },
    kaggle,
    evidence_card: { ran: evidence.ran, reason: evidence.reason ?? null, limitations: evidence.limitations ?? [], hard_limitations: evidence.hard?.limitations ?? [], files: evidence.ran ? ['evidence.html', 'evidence-hard.html'] : [] },
    duration_seconds: Math.round((Date.now() - t0) / 1000),
  };
  delete metrics.detection.primary;
  write('metrics.json', JSON.stringify(metrics, null, 2));
  write('evaluation.md', `${evaluationMd(metrics)}\n${kaggleMd(metrics.kaggle)}`);
  write('data-card.md', dataCardMd(metrics));
  if (fs.existsSync(path.join(ROOT, 'README.md'))) renderReadme();

  const f = offline.summary.hard.full; const s = offline.summary.standard.full;
  log('\n================ RINGKASAN ================');
  log(`Standar: PR-AUC ${s.pr_auc.mean}, recall nilai dipertanyakan@1% ${s.rupiah_recall_at_1pct.mean}, precision@1% ${s.precision_at_1pct.mean}`);
  log(`Hard   : PR-AUC ${f.pr_auc.mean}, recall nilai dipertanyakan@1% ${f.rupiah_recall_at_1pct.mean}, precision@1% ${f.precision_at_1pct.mean}`);
  const h = offline.holdout; const hv = (d, v) => (h[d][v] ? `${h[d][v].recall} (n=${h[d][v].n})` : '-');
  log(`Hold-out ${HOLDOUT_MODUS}: lengkap std ${hv('standard', 'full')}, hard ${hv('hard', 'full')}; ML saja std ${hv('standard', 'no_rules')}, hard ${hv('hard', 'no_rules')}`);
  log(`Paritas ${stack.parity.pct.toFixed(1)}% · PII ${baseline.privacy.pct_with_pii.toFixed(0)}% -> ${proposed.privacy.pct_with_pii.toFixed(0)}% · keamanan ${stack.security.rejected}/${stack.security.total} · fungsional ${stack.functional.passed}/${stack.functional.total}`);
  log(`/verify p95 ${stack.verify.p95_ms} ms · unggah ${stack.upload.rows_per_sec} baris/dtk · evidence card ${evidence.ran ? 'dibuat' : `GAGAL: ${evidence.reason}`}`);
  log(`Selesai dalam ${metrics.duration_seconds} dtk. Laporan: reports/metrics.json, evaluation.md, data-card.md`);
  const bad = [...proposed.security.filter((t) => !t.pass), ...functional.filter((t) => !t.pass)];
  if (bad.length) { console.error('\nADA YANG GAGAL:', bad.map((b) => b.name).join('; ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
