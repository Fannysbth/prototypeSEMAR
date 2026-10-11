// Mesin analisis: ekstraksi fitur -> detektor aturan -> Isolation Forest -> skor risiko (noisy-OR) -> kasus.
import crypto from 'node:crypto';
import { REFERENCE } from '../../shared/reference.js';
import { buildDataset } from '../../shared/synthetic.js';
import { IsolationForest } from './iforest.js';
import { ALL, DAY, THRESHOLDS } from './detectors.js';

export const ENGINE_VERSION = 'samar-fraud-1.0';
export const FEATURE_NAMES = ['rasio_nominal_vs_referensi', 'rasio_lama_rawat', 'rasio_nominal_per_hari', 'jumlah_faskes_30h', 'jumlah_klaim_30h', 'klaim_identik_7h', 'tindakan_tidak_lazim'];

export const toMs = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`);
export function fingerprint(c) {
  return crypto.createHash('sha256').update(`${c.diagnosis_code}|${c.procedure_code || ''}|${c.length_of_stay}|${Math.round(c.amount)}`).digest('hex').slice(0, 16);
}

// Hanya field non-identitas yang disimpan fraud-service (data minimization juga di sisi penyimpanan).
export function buildObservation(input, now = Date.now()) {
  const admit_ms = toMs(input.admit_date);
  const los = Math.max(1, Number(input.length_of_stay) || 1);
  const obs = {
    claim_id: input.claim_id, facility_id: input.facility_id, fraud_ref: input.fraud_ref,
    diagnosis_code: input.diagnosis_code, procedure_code: input.procedure_code || null, claim_type: input.claim_type || 'RI',
    admit_date: input.admit_date, admit_ms, length_of_stay: los, end_ms: admit_ms + los * DAY, amount: Number(input.amount),
    created_ms: now,
  };
  obs.fingerprint = fingerprint(obs);
  return obs;
}

export async function loadContext(observations, obs) {
  const win = 30 * DAY;
  const sameRef = await observations.find(
    { eq: { fraud_ref: obs.fraud_ref }, ne: { claim_id: obs.claim_id }, gte: { admit_ms: obs.admit_ms - win }, lte: { admit_ms: obs.admit_ms + win } },
    { orderBy: 'admit_ms', dir: 'asc', limit: 300 },
  );
  const sameFp = await observations.find(
    { eq: { fingerprint: obs.fingerprint, facility_id: obs.facility_id }, ne: { claim_id: obs.claim_id }, gte: { admit_ms: obs.admit_ms - 7 * DAY }, lte: { admit_ms: obs.admit_ms + 7 * DAY } },
    { limit: 300 },
  );
  return { sameRef, sameFp };
}

export function extractFeatures(obs, ctx) {
  const ref = REFERENCE[obs.diagnosis_code];
  const med = ref?.tariff_median ?? obs.amount;
  const exp = ref?.expected_los ?? obs.length_of_stay;
  const near = ctx.sameRef.filter((o) => Math.abs(o.admit_ms - obs.admit_ms) <= 30 * DAY);
  const facs = new Set([obs.facility_id, ...near.map((o) => o.facility_id)]);
  const identical = 1 + ctx.sameFp.filter((o) => o.fraud_ref !== obs.fraud_ref).length;
  const atypical = ref && obs.procedure_code && !ref.procedures.includes(obs.procedure_code) ? 1 : 0;
  return [obs.amount / med, obs.length_of_stay / exp, (obs.amount / obs.length_of_stay) / (med / exp), facs.size, 1 + near.length, identical, atypical];
}

export const noisyOr = (scores) => Math.round(100 * (1 - scores.reduce((p, s) => p * (1 - s / 100), 1)));
export const riskLevel = (s, th = THRESHOLDS) => (s >= th.levels.high ? 'HIGH' : s >= th.levels.medium ? 'MEDIUM' : s >= th.levels.low ? 'LOW' : 'NONE');

// Melatih Isolation Forest pada klaim NORMAL sintetis, memakai jalur ekstraksi fitur yang sama dengan produksi.
export async function trainForest({ createMemoryCollection, seed = 7, n = 700 } = {}) {
  const items = buildDataset({ seed, normal: n, fraud: false });
  const col = await createMemoryCollection();
  const X = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const obs = buildObservation({ claim_id: `T-${i}`, facility_id: it.facility_id, fraud_ref: it.claim.patient_nik, ...it.claim });
    X.push(extractFeatures(obs, await loadContext(col, obs)));
    await col.put(obs.claim_id, obs);
  }
  return new IsolationForest({ nTrees: 100, sampleSize: 256, seed: 42 }).fit(X);
}

// Mutex per-kunci supaya dua klaim yang saling berkaitan tidak dianalisis bersamaan (menghindari "race" deteksi pola).
class KeyedMutex {
  constructor() { this.tails = new Map(); }
  async run(key, fn) {
    const prev = this.tails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const tail = prev.then(() => gate);
    this.tails.set(key, tail);
    await prev;
    try { return await fn(); } finally { release(); if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
  async runAll(keys, fn) {
    const sorted = [...new Set(keys)].sort();
    const go = (i) => (i >= sorted.length ? fn() : this.run(sorted[i], () => go(i + 1)));
    return go(0);
  }
}

export function createEngine({ observations, cases, forest, thresholds = THRESHOLDS, now = () => Date.now() }) {
  const mutex = new KeyedMutex();

  async function analyzeUnlocked(input) {
    const existing = await observations.get(input.claim_id);
    if (existing?.result) return { ...existing.result, replay: true };

    const obs = buildObservation(input, now());
    const ctx = await loadContext(observations, obs);
    const flags = [];
    for (const detector of ALL) {
      const f = detector(obs, ctx, thresholds);
      if (f) flags.push(f);
    }
    const feats = extractFeatures(obs, ctx);
    const ml = forest.score(feats);
    if (ml >= thresholds.mlFlag) {
      flags.push({
        modus: 'ML_ANOMALY', rule: 'isolation_forest', score: Math.min(60, Math.round(30 + (ml - thresholds.mlFlag) * 150)),
        reason: `Pola klaim tidak lazim secara statistik dibanding klaim normal (skor anomali ${ml.toFixed(2)}).`,
        evidence: { anomaly_score: +ml.toFixed(3), features: Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, +feats[i].toFixed(2)])) },
      });
    }
    const score = flags.length ? noisyOr(flags.map((f) => f.score)) : 0;
    const level = riskLevel(score, thresholds);
    const result = { claim_id: obs.claim_id, risk_score: score, risk_level: level, ml_score: +ml.toFixed(3), flags, case_id: null, engine_version: ENGINE_VERSION };

    if (score >= thresholds.caseScore) {
      const id = `CASE-${obs.claim_id}`;
      result.case_id = id;
      await cases.put(id, {
        case_id: id, claim_id: obs.claim_id, facility_id: obs.facility_id, fraud_ref: obs.fraud_ref,
        diagnosis_code: obs.diagnosis_code, amount: obs.amount, admit_date: obs.admit_date,
        risk_score: score, risk_level: level, modi: [...new Set(flags.map((f) => f.modus))], flags,
        status: 'PENDING_REVIEW', created_ms: obs.created_ms, updated_ms: obs.created_ms, reviews: [],
      });
    }
    await observations.put(obs.claim_id, { ...obs, result });
    return result;
  }

  async function analyze(input) {
    return mutex.runAll([`ref:${input.fraud_ref}`, `claim:${input.claim_id}`], () => analyzeUnlocked(input));
  }

  const REVIEW_STATUS = { CONFIRMED_FRAUD: 'CONFIRMED', DISMISSED_FALSE_POSITIVE: 'DISMISSED', NEEDS_MORE_INFO: 'NEEDS_INFO' };
  async function review(caseId, { decision, note, reviewer }) {
    const c = await cases.get(caseId);
    if (!c) return null;
    const entry = { decision, note, reviewer, ts_ms: now() };
    return cases.update(caseId, { status: REVIEW_STATUS[decision], updated_ms: now(), reviews: [...c.reviews, entry] });
  }

  async function stats() {
    const all = await cases.find({}, { limit: 5000 });
    const by = (k) => all.reduce((m, c) => { for (const v of [].concat(c[k])) m[v] = (m[v] || 0) + 1; return m; }, {});
    const reviewed = all.filter((c) => ['CONFIRMED', 'DISMISSED'].includes(c.status));
    const confirmed = reviewed.filter((c) => c.status === 'CONFIRMED').length;
    return {
      total_cases: all.length, by_status: by('status'), by_level: by('risk_level'), by_modus: by('modi'),
      analyzed_claims: await observations.count({}),
      review_precision: reviewed.length ? +(confirmed / reviewed.length).toFixed(3) : null,
      engine_version: ENGINE_VERSION,
    };
  }

  return { analyze, review, stats };
}
