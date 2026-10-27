// Evaluasi deteksi offline: grid seed x fraud rate x tingkat kesulitan, uji hanya pada bulan 5-6, empat varian (ablasi).
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildEvalDataset, HOLDOUT_MODUS, TRAIN_DAYS } from './dataset.js';
import { CASE_SCORE, scoreVariants } from './score.js';
import { bootstrapCI, capacityK, liftAtK, prAuc, precisionAtK, recallAtK, rocAuc, rupiahRecallAtK } from '../../shared/metrics.js';

export const SEEDS = [42, 43, 44];
export const FRAUD_RATES = [0.01, 0.03];
export const DIFFICULTIES = ['standard', 'hard'];
export const CAPACITY = 0.01; // asumsi kapasitas review: 1% klaim
export const VARIANTS = { full: 'SAMAR lengkap', no_ml: 'Tanpa ML (aturan saja)', no_rules: 'Tanpa aturan (ML saja)', no_cross: 'Tanpa fitur lintas faskes' };
// Atribut faskes sintetis hanya untuk stratifikasi laporan eval-kit.
export const FACILITY_STRATA = { 'RS-A': { level: 'B', region: 'Barat' }, 'RS-B': { level: 'B', region: 'Timur' }, 'RS-C': { level: 'C', region: 'Barat' }, 'RS-D': { level: 'C', region: 'Timur' } };
export const patientToken = (nik) => `T-${crypto.createHash('sha256').update(`samar-eval|${nik}`).digest('hex').slice(0, 12)}`;

const round = (n, d = 4) => (n === null || n === undefined ? null : +Number(n).toFixed(d));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function wilson(hit, n, z = 1.96) {
  if (!n) return { lo: null, hi: null };
  const p = hit / n; const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d; const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: round(Math.max(0, c - m)), hi: round(Math.min(1, c + m)) };
}

function metricsFor(testRows, scored, groups) {
  const s = scored.map((x) => x.score); const y = testRows.map((r) => r.label); const ex = testRows.map((r) => r.excess);
  const n = testRows.length; const fraud = y.reduce((a, b) => a + b, 0);
  const at = (cap) => { const k = capacityK(n, cap); return { k, precision: precisionAtK(s, y, k), recall: recallAtK(s, y, k), lift: liftAtK(s, y, k), rupiah_recall: rupiahRecallAtK(s, y, ex, k) }; };
  const k1 = capacityK(n, CAPACITY);
  const sub = (stat) => (idx) => stat(idx.map((i) => s[i]), idx.map((i) => y[i]), idx.map((i) => ex[i]));
  const ci = (stat) => bootstrapCI(n, groups, sub(stat), { B: 200, seed: 7 });
  const flagged = scored.map((x) => x.score >= CASE_SCORE);
  const tp = flagged.filter((f, i) => f && y[i]).length; const nf = flagged.filter(Boolean).length;
  const per_modus = {};
  testRows.forEach((r, i) => {
    if (!r.label) return;
    const m = (per_modus[r.modus] ??= { n: 0, hit: 0 });
    m.n += 1; if (flagged[i]) m.hit += 1;
  });
  for (const m of Object.values(per_modus)) m.recall = round(m.hit / m.n);
  const c1 = at(CAPACITY);
  return {
    n_test: n, n_fraud: fraud, fraud_rate: round(fraud / n, 5),
    capacity_1pct: { k: c1.k, precision: round(c1.precision), recall: round(c1.recall), lift: round(c1.lift, 2), rupiah_recall: round(c1.rupiah_recall) },
    capacity_3pct: (() => { const c = at(0.03); return { k: c.k, precision: round(c.precision), recall: round(c.recall), lift: round(c.lift, 2), rupiah_recall: round(c.rupiah_recall) }; })(),
    pr_auc: round(prAuc(s, y)), roc_auc: round(rocAuc(s, y)),
    ci95: {
      precision_1pct: ci((ss, yy) => precisionAtK(ss, yy, k1)), recall_1pct: ci((ss, yy) => recallAtK(ss, yy, k1)),
      rupiah_recall_1pct: ci((ss, yy, ee) => rupiahRecallAtK(ss, yy, ee, k1)), pr_auc: ci((ss, yy) => prAuc(ss, yy)),
    },
    queue_at_case_threshold: { threshold: CASE_SCORE, cases: nf, precision: nf ? round(tp / nf) : null, recall: fraud ? round(tp / fraud) : null },
    per_modus,
  };
}

export async function runOne({ seed, fraudRate, difficulty, peserta, workDir }) {
  const { rows, params } = buildEvalDataset({ peserta, seed, fraudRate, difficulty });
  const { variants } = await scoreVariants(rows, path.join(workDir, `${difficulty}-${seed}-${fraudRate}`));
  const testIdx = rows.map((_, i) => i).filter((i) => rows[i].split === 'test');
  const testRows = testIdx.map((i) => rows[i]);
  const groups = testRows.map((r) => r.claim.patient_nik);
  const out = { seed, fraud_rate_target: fraudRate, difficulty, params, n_all: rows.length, n_train: rows.length - testRows.length, variants: {} };
  for (const v of Object.keys(VARIANTS)) out.variants[v] = metricsFor(testRows, testIdx.map((i) => variants[v][i]), groups);
  return { summary: out, rows, variants, testIdx };
}

const stat = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined); return v.length ? { mean: round(mean(v)), min: round(Math.min(...v)), max: round(Math.max(...v)) } : null; };

export function aggregate(runs) {
  const summary = {}; const holdout = {};
  for (const difficulty of DIFFICULTIES) {
    const rs = runs.filter((r) => r.difficulty === difficulty);
    summary[difficulty] = { n_runs: rs.length };
    holdout[difficulty] = {};
    for (const v of Object.keys(VARIANTS)) {
      const pick = (fn) => stat(rs.map((r) => fn(r.variants[v])));
      const pooled = {};
      for (const r of rs) for (const [m, x] of Object.entries(r.variants[v].per_modus)) { pooled[m] ??= { n: 0, hit: 0 }; pooled[m].n += x.n; pooled[m].hit += x.hit; }
      for (const x of Object.values(pooled)) { x.recall = round(x.hit / x.n); x.ci95 = wilson(x.hit, x.n); }
      summary[difficulty][v] = {
        precision_at_1pct: pick((m) => m.capacity_1pct.precision), recall_at_1pct: pick((m) => m.capacity_1pct.recall), lift_at_1pct: pick((m) => m.capacity_1pct.lift),
        rupiah_recall_at_1pct: pick((m) => m.capacity_1pct.rupiah_recall), precision_at_3pct: pick((m) => m.capacity_3pct.precision), recall_at_3pct: pick((m) => m.capacity_3pct.recall),
        rupiah_recall_at_3pct: pick((m) => m.capacity_3pct.rupiah_recall),
        pr_auc: pick((m) => m.pr_auc), roc_auc: pick((m) => m.roc_auc), queue_precision: pick((m) => m.queue_at_case_threshold.precision), queue_recall: pick((m) => m.queue_at_case_threshold.recall),
        per_modus_pooled: pooled,
      };
      holdout[difficulty][v] = pooled[HOLDOUT_MODUS] ?? null;
    }
    // rendah/sedang/tinggi untuk simulasi dampak diambil dari set hard (lebih konservatif) varian lengkap.
  }
  const rr = runs.filter((r) => r.difficulty === 'hard').map((r) => r.variants.full.capacity_1pct.rupiah_recall).filter((x) => x !== null);
  const impact_inputs = { rupiah_recall: { low: round(Math.min(...rr)), mid: round(mean(rr)), high: round(Math.max(...rr)) }, source: 'recall nilai dipertanyakan @1% kapasitas, varian SAMAR lengkap, set uji hard, min/rerata/maks atas 6 run' };
  return { summary, holdout, impact_inputs };
}

export async function runGrid({ peserta = 4000, log = () => {} } = {}) {
  const workDir = path.join(os.tmpdir(), `samar-eval-${process.pid}`);
  const runs = []; let primary = {};
  for (const difficulty of DIFFICULTIES) {
    for (const fraudRate of FRAUD_RATES) {
      for (const seed of SEEDS) {
        const t0 = Date.now();
        const r = await runOne({ seed, fraudRate, difficulty, peserta, workDir });
        runs.push(r.summary);
        if (seed === SEEDS[0] && fraudRate === 0.03) primary[difficulty] = r;
        const m = r.summary.variants.full;
        log(`  ${difficulty} seed ${seed} fraud ${fraudRate * 100}%: ${m.n_test} klaim uji, ${m.n_fraud} fraud, PR-AUC ${m.pr_auc}, recall nilai dipertanyakan@1% ${m.capacity_1pct.rupiah_recall} (${((Date.now() - t0) / 1000).toFixed(0)} dtk)`);
      }
    }
  }
  return { runs, ...aggregate(runs), primary };
}

// Berkas untuk eval-kit dari satu run: hanya klaim uji. group_id = token pasien (hash), tanpa NIK.
export function evalkitFiles({ rows, variants, testIdx }) {
  const scores = ['entity_id,group_id,score,level,region']; const truth = ['entity_id,label,modus,excess_rupiah']; const cases = ['entity_id,group_id,level,region,diagnosis_code,claim_type,length_of_stay,amount'];
  for (const i of testIdx) {
    const r = rows[i]; const st = FACILITY_STRATA[r.facility_id]; const g = patientToken(r.claim.patient_nik);
    scores.push([r.claim_ref, g, round(variants.full[i].score, 5), st.level, st.region].join(','));
    truth.push([r.claim_ref, r.label, r.modus ?? '', r.excess].join(','));
    cases.push([r.claim_ref, g, st.level, st.region, r.claim.diagnosis_code, r.claim.claim_type, r.claim.length_of_stay, r.claim.amount].join(','));
  }
  return { 'scores.csv': `${scores.join('\n')}\n`, 'truth.csv': `${truth.join('\n')}\n`, 'cases.csv': `${cases.join('\n')}\n` };
}

export { HOLDOUT_MODUS, TRAIN_DAYS };
