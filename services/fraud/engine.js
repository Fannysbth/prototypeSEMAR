// Mesin analisis: fitur lintas-faskes per token -> detektor aturan -> layanan ml (Isolation Forest + supervised)
// -> skor risiko (noisy-OR berbobot, config/weights.json) -> kasus.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/config.js';
import { HttpError } from '../../shared/http.js';
import { REFERENCE } from '../../shared/reference.js';
import { buildDataset } from '../../shared/synthetic.js';
import { IsolationForest } from './iforest.js';
import { ALL, DAY, THRESHOLDS } from './detectors.js';

export const ENGINE_VERSION = 'samar-fraud-2.0';
export const WEIGHTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'weights.json'), 'utf8'));
export const CASE_STATUSES = ['BARU', 'DITINJAU', 'BUTUH_INFO', 'TERKONFIRMASI', 'DITOLAK_FALSE_POSITIVE', 'SELESAI'];
export const FEATURE_NAMES = [
  'n_faskes_30d', 'n_kunjungan_30d', 'n_rs_7d', 'overlap_inap_hari', 'same_diag_multi_faskes_14d', 'referral_loop',
  'los_vs_median_inacbg', 'billed_vs_median_inacbg', 'n_prosedur_terpisah_sehari', 'klaim_identik_7h', 'tindakan_tidak_lazim',
];

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

// Semua fitur dihitung per token pasien (fraud_ref), tanpa identitas. Urutan = FEATURE_NAMES.
export function extractFeatures(obs, ctx) {
  const ref = REFERENCE[obs.diagnosis_code];
  const med = ref?.tariff_median ?? obs.amount;
  const exp = ref?.expected_los ?? obs.length_of_stay;
  const near = ctx.sameRef.filter((o) => Math.abs(o.admit_ms - obs.admit_ms) <= 30 * DAY);
  const others = near.filter((o) => o.facility_id !== obs.facility_id);
  const distinct = (rows) => new Set(rows.map((o) => o.facility_id));
  const within = (rows, days) => rows.filter((o) => Math.abs(o.admit_ms - obs.admit_ms) <= days * DAY);
  const overlap = others.reduce((s, o) => s + Math.max(0, Math.min(obs.end_ms, o.end_ms) - Math.max(obs.admit_ms, o.admit_ms)) / DAY, 0);
  const seq = [...near, obs].sort((a, b) => a.admit_ms - b.admit_ms);
  let loop = 0;
  for (let i = 0; i < seq.length && !loop; i += 1) {
    for (let j = i + 1; j < seq.length && !loop; j += 1) {
      for (let k = j + 1; k < seq.length; k += 1) {
        if (seq[k].admit_ms - seq[i].admit_ms <= 30 * DAY && seq[i].facility_id === seq[k].facility_id && seq[j].facility_id !== seq[i].facility_id) { loop = 1; break; }
      }
    }
  }
  const sameDay = near.filter((o) => o.facility_id === obs.facility_id && o.admit_ms === obs.admit_ms).length;
  const identical = 1 + ctx.sameFp.filter((o) => o.fraud_ref !== obs.fraud_ref).length;
  const atypical = ref && obs.procedure_code && !ref.procedures.includes(obs.procedure_code) ? 1 : 0;
  return [
    distinct([...near, obs]).size, 1 + near.length, distinct([...within(near, 7), obs]).size, overlap,
    distinct(within(others.filter((o) => o.diagnosis_code === obs.diagnosis_code), 14)).size, loop,
    obs.length_of_stay / exp, obs.amount / med, 1 + sameDay, identical, atypical,
  ];
}
const named = (feats) => Object.fromEntries(FEATURE_NAMES.map((n, i) => [n, +feats[i].toFixed(2)]));

export const noisyOr = (scores) => Math.round(100 * (1 - scores.reduce((p, s) => p * (1 - s / 100), 1)));
export const riskLevel = (s, th = THRESHOLDS) => (s >= th.levels.high ? 'HIGH' : s >= th.levels.medium ? 'MEDIUM' : s >= th.levels.low ? 'LOW' : 'NONE');
const weightOf = (f) => (f.modus === 'ML_ANOMALY' ? WEIGHTS.ml_isolation_forest : f.modus === 'ML_SUPERVISED' ? WEIGHTS.ml_supervised : (WEIGHTS.rules[f.rule] ?? 1));

// Sinyal ML -> flag (sama untuk layanan dan evaluator offline). m: { if_score, sup_score, top }.
export function mlFlags(m, features, th = THRESHOLDS) {
  const out = [];
  if (m.if_score >= th.mlFlag) {
    out.push({
      modus: 'ML_ANOMALY', rule: 'isolation_forest', score: Math.min(60, Math.round(30 + (m.if_score - th.mlFlag) * 150)),
      reason: `Pola klaim tidak lazim secara statistik dibanding klaim normal (skor anomali ${m.if_score.toFixed(2)}).`,
      evidence: { anomaly_score: +m.if_score.toFixed(3), features },
    });
  }
  if (m.sup_score >= WEIGHTS.ml_supervised_min) {
    const top = m.top ?? [];
    out.push({
      modus: 'ML_SUPERVISED', rule: 'supervised_model', score: Math.round(m.sup_score * 100),
      reason: `Model supervised menilai pola kunjungan lintas faskes mirip kasus yang pernah dikonfirmasi (skor ${m.sup_score.toFixed(2)}${top.length ? `; fitur teratas: ${top.slice(0, 3).map(([k]) => k).join(', ')}` : ''}).`,
      evidence: { supervised_score: +m.sup_score.toFixed(3), top_features: top, features },
    });
  }
  return out;
}
export function combineFlags(flags, { round = true } = {}) {
  if (!flags.length) return 0;
  const raw = 100 * (1 - flags.reduce((p, f) => p * (1 - (f.score * weightOf(f)) / 100), 1));
  return round ? Math.round(raw) : raw;
}

// Estimasi rupiah berlebih per kasus (indikatif, bukan angka audit).
function estimateExcess(obs, flags) {
  const ref = REFERENCE[obs.diagnosis_code];
  const per = flags.map((f) => {
    if (f.modus === 'UPCODING' && ref) return Math.max(0, obs.amount - ref.tariff_median);
    if (f.modus === 'PROLONGED_LOS' && ref) return obs.amount * Math.max(0, obs.length_of_stay - ref.expected_los) / obs.length_of_stay;
    if (['PHANTOM_BILLING', 'CLONING', 'REPEAT_BILLING'].includes(f.modus)) return obs.amount;
    return 0;
  });
  return Math.round(Math.max(0, ...per));
}

// Melatih Isolation Forest pada klaim NORMAL sintetis (jalur lokal/legacy; layanan ml memakai scikit-learn).
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

// ml: { score(fiturBernama) -> { if_score, sup_score, model_version, top_features } } (melempar galat bila layanan mati)
// forest: jalur lokal tanpa layanan ml (dipakai tes lama). events/settings: koleksi opsional.
export function createEngine({ observations, cases, events, settings, forest, ml, thresholds = THRESHOLDS, now = () => Date.now() }) {
  const mutex = new KeyedMutex();
  const th = { ...thresholds, levels: { ...thresholds.levels } };
  const loaded = settings ? settings.get('thresholds').then((s) => { if (s) th.caseScore = s.case_score; }) : Promise.resolve();

  const getThresholds = () => ({ case_score: th.caseScore, levels: { ...th.levels } });
  async function setThresholds({ case_score }) {
    if (!Number.isInteger(case_score) || case_score < th.levels.low || case_score > 100) throw new HttpError(400, 'INVALID_THRESHOLD', `case_score harus bilangan bulat ${th.levels.low}-100`);
    th.caseScore = case_score;
    await settings?.put('thresholds', { case_score });
    return getThresholds();
  }

  async function logEvent(case_id, actor, from_status, to_status, note) {
    await events?.put(crypto.randomUUID(), { case_id, actor, from_status, to_status, note: note ?? null, at_ms: now() });
  }

  async function mlScores(feats) {
    if (ml) {
      try {
        const m = await ml.score(named(feats));
        return { status: 'ok', if_score: m.if_score, sup_score: m.sup_score, model_version: m.model_version, top: m.top_features ?? [] };
      } catch { return { status: 'unavailable', if_score: 0, sup_score: 0, top: [] }; }
    }
    if (forest) return { status: 'local', if_score: forest.score(feats), sup_score: 0, top: [] };
    return { status: 'disabled', if_score: 0, sup_score: 0, top: [] };
  }

  async function analyzeUnlocked(input) {
    await loaded;
    const existing = await observations.get(input.claim_id);
    if (existing?.result) return { ...existing.result, replay: true };

    const obs = buildObservation(input, now());
    const ctx = await loadContext(observations, obs);
    const flags = [];
    for (const detector of ALL) {
      const f = detector(obs, ctx, th);
      if (f) flags.push(f);
    }
    const feats = extractFeatures(obs, ctx);
    const features = named(feats);
    const m = await mlScores(feats);
    flags.push(...mlFlags(m, features, th));
    const score = combineFlags(flags);
    const level = riskLevel(score, th);
    const result = {
      claim_id: obs.claim_id, risk_score: score, risk_level: level, ml_score: +m.if_score.toFixed(3), sup_score: +m.sup_score.toFixed(3),
      ml_status: m.status, model_version: m.model_version ?? null, flags, features, case_id: null, engine_version: ENGINE_VERSION,
    };

    if (score >= th.caseScore) {
      const id = `CASE-${obs.claim_id}`;
      result.case_id = id;
      await cases.put(id, {
        case_id: id, claim_id: obs.claim_id, facility_id: obs.facility_id, fraud_ref: obs.fraud_ref,
        facilities: [...new Set([obs.facility_id, ...ctx.sameRef.map((o) => o.facility_id)])].sort(),
        diagnosis_code: obs.diagnosis_code, amount: obs.amount, admit_date: obs.admit_date, excess_amount: estimateExcess(obs, flags),
        risk_score: score, risk_level: level, modi: [...new Set(flags.map((f) => f.modus))], flags, features, ml_status: m.status,
        status: 'BARU', created_ms: obs.created_ms, updated_ms: obs.created_ms, reviews: [],
      });
      await logEvent(id, 'system', null, 'BARU', 'kasus dibuat otomatis');
    }
    await observations.put(obs.claim_id, { ...obs, result });
    return result;
  }

  async function analyze(input) {
    // fp: klaim identik dari pasien berbeda (cloning) juga harus berurutan agar unggahan batch paralel tidak melewatkan pola.
    return mutex.runAll([`ref:${input.fraud_ref}`, `claim:${input.claim_id}`, `fp:${input.facility_id}:${fingerprint({ ...input, procedure_code: input.procedure_code ?? '' })}`], () => analyzeUnlocked(input));
  }

  async function setStatus(caseId, { status, note, actor }) {
    if (!CASE_STATUSES.includes(status)) throw new HttpError(400, 'INVALID_STATUS', `Status harus salah satu dari ${CASE_STATUSES.join(', ')}`);
    const c = await cases.get(caseId);
    if (!c) return null;
    const updated = await cases.update(caseId, { status, updated_ms: now() });
    await logEvent(caseId, actor, c.status, status, note);
    return updated;
  }

  const REVIEW_STATUS = { CONFIRMED_FRAUD: 'TERKONFIRMASI', DISMISSED_FALSE_POSITIVE: 'DITOLAK_FALSE_POSITIVE', NEEDS_MORE_INFO: 'BUTUH_INFO' };
  async function review(caseId, { decision, note, reviewer }) {
    const c = await cases.get(caseId);
    if (!c) return null;
    await setStatus(caseId, { status: REVIEW_STATUS[decision], note, actor: reviewer });
    return cases.update(caseId, { reviews: [...c.reviews, { decision, note, reviewer, ts_ms: now() }] });
  }

  async function listCases({ risk, modus, status, faskes, from, to, limit = 100 } = {}) {
    const filter = { eq: {}, gte: {}, lte: {} };
    if (risk) filter.eq.risk_level = risk;
    if (status) filter.eq.status = status;
    if (from) filter.gte.created_ms = toMs(from);
    if (to) filter.lte.created_ms = toMs(to) + DAY - 1;
    const rows = await cases.find(filter, { orderBy: 'created_ms', dir: 'desc', limit: 2000 });
    return rows.filter((c) => (!modus || c.modi.includes(modus)) && (!faskes || c.facilities.includes(faskes))).slice(0, limit);
  }

  async function getCase(caseId) {
    const c = await cases.get(caseId);
    if (!c) return null;
    const history = (await observations.find({ eq: { fraud_ref: c.fraud_ref } }, { orderBy: 'admit_ms', dir: 'asc', limit: 200 }))
      .map((o) => ({ claim_id: o.claim_id, facility_id: o.facility_id, admit_date: o.admit_date, length_of_stay: o.length_of_stay, diagnosis_code: o.diagnosis_code, claim_type: o.claim_type, amount: o.amount }));
    const evs = events ? await events.find({ eq: { case_id: caseId } }, { orderBy: 'at_ms', dir: 'asc' }) : [];
    return { ...c, history, events: evs };
  }

  async function stats() {
    const all = await cases.find({}, { limit: 5000 });
    const by = (k) => all.reduce((acc, c) => { for (const v of [].concat(c[k])) acc[v] = (acc[v] || 0) + 1; return acc; }, {});
    const reviewed = all.filter((c) => ['TERKONFIRMASI', 'DITOLAK_FALSE_POSITIVE'].includes(c.status));
    const confirmed = reviewed.filter((c) => c.status === 'TERKONFIRMASI').length;
    return {
      total_cases: all.length, by_status: by('status'), by_level: by('risk_level'), by_modus: by('modi'), by_facility: by('facilities'),
      excess_total: all.reduce((s, c) => s + (c.excess_amount || 0), 0),
      analyzed_claims: await observations.count({}),
      review_precision: reviewed.length ? +(confirmed / reviewed.length).toFixed(3) : null,
      engine_version: ENGINE_VERSION,
    };
  }

  return { analyze, review, setStatus, listCases, getCase, getThresholds, setThresholds, stats };
}
