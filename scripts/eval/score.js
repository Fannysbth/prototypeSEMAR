// Skoring offline untuk evaluasi: memakai kode engine yang sama (fitur lintas faskes, 7 detektor, noisyOr) dan model ml
// yang sama (services/ml/models.py), tetapi dilatih HANYA dari klaim masa latih (split waktu) per run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../shared/config.js';
import { createStore } from '../../shared/store.js';
import { FEATURE_NAMES, buildObservation, combineFlags, extractFeatures, loadContext, mlFlags } from '../../services/fraud/engine.js';
import { ALL, THRESHOLDS } from '../../services/fraud/detectors.js';
import { HOLDOUT_MODUS, TRAIN_DAYS } from './dataset.js';

let runSeq = 0;
export const CASE_SCORE = THRESHOLDS.caseScore;

const pythonBin = () => ['Scripts/python.exe', 'bin/python'].map((p) => path.join(ROOT, 'services', 'ml', '.venv', p)).find((p) => fs.existsSync(p)) ?? (process.platform === 'win32' ? 'python' : 'python3');

// crossFacility=false meniru sistem yang hanya melihat riwayat di faskes sendiri (tanpa token lintas faskes).
export async function extractRun(rows, { crossFacility }) {
  const col = await (await createStore({ driver: 'memory', namespace: `eval_${crossFacility ? 'x' : 'l'}_${(runSeq += 1)}` })).collection('obs');
  const out = [];
  for (const r of rows) {
    const obs = buildObservation({ claim_id: r.claim_ref, facility_id: r.facility_id, fraud_ref: r.claim.patient_nik, ...r.claim });
    const ctx = await loadContext(col, obs);
    if (!crossFacility) ctx.sameRef = ctx.sameRef.filter((o) => o.facility_id === obs.facility_id);
    const ruleFlags = [];
    for (const detector of ALL) { const f = detector(obs, ctx, THRESHOLDS); if (f) ruleFlags.push(f); }
    out.push({ feats: extractFeatures(obs, ctx), ruleFlags });
    await col.put(obs.claim_id, obs);
  }
  return out;
}

// Model dilatih dari baris day < TRAIN_DAYS; baris hold-out tidak ikut melatih model supervised.
export function mlScoreRun(rows, extracted, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, 'features.csv'); const outFile = path.join(tmpDir, 'scores.csv');
  const lines = [['claim_ref', 'day', 'label', 'holdout', ...FEATURE_NAMES].join(',')];
  rows.forEach((r, i) => lines.push([r.claim_ref, r.day, r.label, r.modus === HOLDOUT_MODUS ? 1 : 0, ...extracted[i].feats.map((f) => +f.toFixed(4))].join(',')));
  fs.writeFileSync(inFile, `${lines.join('\n')}\n`);
  const res = spawnSync(pythonBin(), ['score_csv.py', inFile, outFile, String(TRAIN_DAYS)], { cwd: path.join(ROOT, 'services', 'ml'), encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`score_csv.py gagal: ${(res.stderr || '').slice(-400)}`);
  const [, ...recs] = fs.readFileSync(outFile, 'utf8').trim().split('\n');
  return recs.map((l) => { const [, a, b] = l.split(','); return { if_score: Number(a), sup_score: Number(b) }; });
}

const named = (feats) => Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, +feats[i].toFixed(2)]));

// Empat varian: full, tanpa ML, tanpa aturan, tanpa fitur lintas faskes. Skor tidak dibulatkan agar peringkat tidak penuh skor imbang.
export async function scoreVariants(rows, workDir) {
  const cross = await extractRun(rows, { crossFacility: true });
  const local = await extractRun(rows, { crossFacility: false });
  const mlCross = mlScoreRun(rows, cross, path.join(workDir, 'cross'));
  const mlLocal = mlScoreRun(rows, local, path.join(workDir, 'local'));
  const raw = (flags) => combineFlags(flags, { round: false });
  const out = { full: [], no_ml: [], no_rules: [], no_cross: [] };
  rows.forEach((_, i) => {
    const mc = mlFlags(mlCross[i], named(cross[i].feats)); const ml = mlFlags(mlLocal[i], named(local[i].feats));
    const flagsOf = (f) => ({ score: raw(f), modi: [...new Set(f.map((x) => x.modus))] });
    out.full.push(flagsOf([...cross[i].ruleFlags, ...mc]));
    out.no_ml.push(flagsOf(cross[i].ruleFlags));
    out.no_rules.push(flagsOf(mc));
    out.no_cross.push(flagsOf([...local[i].ruleFlags, ...ml]));
  });
  return { variants: out, extracted: cross, tmp: os.tmpdir() };
}
