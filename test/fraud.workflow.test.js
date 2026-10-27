// T2: fitur lintas faskes, integrasi ml (dan fallback saat ml mati), bobot noisy-OR, alur status kasus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../shared/store.js';
import { createEngine, WEIGHTS, CASE_STATUSES } from '../services/fraud/engine.js';

const claim = (id, fac, ref, o = {}) => ({ claim_id: id, facility_id: fac, fraud_ref: ref, diagnosis_code: 'I10', procedure_code: '89.52', claim_type: 'RJ', admit_date: '2026-10-01', length_of_stay: 1, amount: 850000, ...o });

async function newEngine(extra = {}) {
  const st = await createStore({ driver: 'memory', namespace: 'f' });
  return createEngine({ observations: await st.collection('o'), cases: await st.collection('c'), events: await st.collection('e'), settings: await st.collection('s'), ...extra });
}

test('fitur lintas faskes per token: faskes, kunjungan, tumpang tindih, loop rujukan, prosedur terpisah', async () => {
  const e = await newEngine();
  await e.analyze(claim('A1', 'RS-A', 'T1', { admit_date: '2026-10-01', claim_type: 'RI', length_of_stay: 5, diagnosis_code: 'J18.9', procedure_code: '87.44', amount: 6000000 }));
  await e.analyze(claim('B1', 'RS-B', 'T1', { admit_date: '2026-10-03', claim_type: 'RI', length_of_stay: 4, diagnosis_code: 'J18.9', procedure_code: '87.44', amount: 6000000 }));
  const r = await e.analyze(claim('A2', 'RS-A', 'T1', { admit_date: '2026-10-08', diagnosis_code: 'J18.9', procedure_code: '87.44', amount: 900000 }));
  const f = r.features;
  assert.equal(f.n_faskes_30d, 2); assert.equal(f.n_kunjungan_30d, 3);
  assert.equal(f.referral_loop, 1);
  assert.equal(f.same_diag_multi_faskes_14d, 1);
  const b = (await e.analyze(claim('B2', 'RS-B', 'T1', { admit_date: '2026-10-04', claim_type: 'RI', length_of_stay: 3, diagnosis_code: 'J18.9', procedure_code: '87.44', amount: 6000000 }))).features;
  assert.ok(b.overlap_inap_hari >= 2, `overlap ${b.overlap_inap_hari}`);
  const s1 = await e.analyze(claim('S1', 'RS-C', 'T9')); const s2 = await e.analyze(claim('S2', 'RS-C', 'T9', { procedure_code: '90.01' }));
  assert.equal(s1.features.n_prosedur_terpisah_sehari, 1); assert.equal(s2.features.n_prosedur_terpisah_sehari, 2);
  for (const k of ['los_vs_median_inacbg', 'billed_vs_median_inacbg']) assert.equal(typeof f[k], 'number');
});

test('ml mati: deteksi aturan tetap jalan, kasus ditandai "ml tidak tersedia", skor ML 0', async () => {
  const e = await newEngine({ ml: { score: async () => { throw new Error('down'); } } });
  const r = await e.analyze(claim('U1', 'RS-A', 'T2', { diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', length_of_stay: 4, amount: 18000000 }));
  assert.ok(r.flags.some((x) => x.modus === 'UPCODING')); assert.ok(r.case_id);
  assert.equal(r.ml_status, 'unavailable'); assert.equal(r.ml_score, 0);
  assert.equal((await e.getCase(r.case_id)).ml_status, 'unavailable');
});

test('ml aktif: skor supervised masuk noisy-OR berbobot dari config/weights.json', async () => {
  let seen;
  const e = await newEngine({ ml: { score: async (feats) => { seen = feats; return { if_score: 0.3, sup_score: 0.8, model_version: 'm-test', top_features: [['n_faskes_30d', 0.4]] }; } } });
  const r = await e.analyze(claim('M1', 'RS-A', 'T3'));
  assert.ok('n_faskes_30d' in seen && 'referral_loop' in seen);
  const f = r.flags.find((x) => x.modus === 'ML_SUPERVISED');
  assert.ok(f); assert.equal(r.ml_status, 'ok');
  assert.equal(r.risk_score, Math.round(f.score * WEIGHTS.ml_supervised));
});

test('alur kasus: BARU -> status baru, tiap perubahan masuk case_events; status tak dikenal ditolak', async () => {
  const e = await newEngine();
  const r = await e.analyze(claim('K1', 'RS-A', 'T4', { diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', length_of_stay: 4, amount: 18000000 }));
  assert.equal((await e.getCase(r.case_id)).status, 'BARU');
  await e.setStatus(r.case_id, { status: 'DITINJAU', actor: 'v1', note: 'mulai' });
  await e.setStatus(r.case_id, { status: 'TERKONFIRMASI', actor: 'v1', note: 'dokumen tidak ada' });
  const c = await e.getCase(r.case_id);
  assert.deepEqual(c.events.map((x) => [x.from_status, x.to_status]), [[null, 'BARU'], ['BARU', 'DITINJAU'], ['DITINJAU', 'TERKONFIRMASI']]);
  await assert.rejects(() => e.setStatus(r.case_id, { status: 'ACAK', actor: 'v1' }), (err) => err.status === 400);
  assert.equal(CASE_STATUSES.length, 6);
  assert.equal((await e.listCases({ status: 'TERKONFIRMASI' })).length, 1);
  assert.equal((await e.listCases({ risk: 'HIGH', modus: 'UPCODING', faskes: 'RS-A' })).length, 1);
  assert.equal((await e.listCases({ modus: 'CLONING' })).length, 0);
});

test('ambang kasus bisa diubah dan berlaku untuk klaim berikutnya', async () => {
  const e = await newEngine();
  assert.equal(e.getThresholds().case_score, 45);
  await e.setThresholds({ case_score: 95 });
  const r = await e.analyze(claim('H1', 'RS-A', 'T5', { diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', length_of_stay: 4, amount: 18000000 }));
  assert.equal(r.case_id, null);
  await assert.rejects(() => e.setThresholds({ case_score: 5 }), (err) => err.status === 400);
});
