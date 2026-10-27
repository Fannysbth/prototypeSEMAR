import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../shared/store.js';
import { createEngine, trainForest, noisyOr, riskLevel } from '../services/fraud/engine.js';
import { IsolationForest } from '../services/fraud/iforest.js';
import { PatientFactory, SCENARIOS, makeRng, addDays, buildDataset, baseClaim } from '../shared/synthetic.js';

let forest;
test.before(async () => {
  const scratch = await createStore({ driver: 'memory', namespace: 'train' });
  forest = await trainForest({ createMemoryCollection: () => scratch.collection('obs'), n: 400 });
});

async function newEngine() {
  const st = await createStore({ driver: 'memory', namespace: 'f' });
  return createEngine({ observations: await st.collection('o'), cases: await st.collection('c'), forest });
}
let n = 0;
const run = async (engine, scenario, seed = 11) => {
  const rng = makeRng(seed + (n += 1));
  const out = [];
  for (const it of SCENARIOS[scenario](rng, new PatientFactory(rng), '2026-08-10')) {
    out.push({ it, r: await engine.analyze({ claim_id: `C${n}-${out.length}`, facility_id: it.facility_id, fraud_ref: it.claim.patient_nik, ...it.claim }) });
  }
  return out;
};
const modi = (r) => r.flags.map((f) => f.modus);

test('klaim wajar tidak memicu kasus', async () => {
  const e = await newEngine();
  for (let i = 0; i < 25; i += 1) { const [{ r }] = await run(e, 'normal', 100 + i); assert.ok(r.risk_score < 45, `skor ${r.risk_score} ${modi(r)}`); assert.equal(r.case_id, null); }
});
test('self-referral: 2 faskes = MEDIUM, 3 faskes = HIGH', async () => {
  const [, s2, s3] = await run(await newEngine(), 'self_referral');
  assert.ok(modi(s2.r).includes('SELF_REFERRAL') && s2.r.risk_score >= 45);
  assert.ok(modi(s3.r).includes('SELF_REFERRAL') && s3.r.risk_level === 'HIGH');
});
test('phantom billing: rawat tumpang tindih lintas faskes', async () => {
  const [, s2] = await run(await newEngine(), 'phantom');
  assert.ok(modi(s2.r).includes('PHANTOM_BILLING')); assert.ok(s2.r.risk_score >= 90);
});
test('cloning: baru terdeteksi pada klaim identik ke-3 dari pasien berbeda', async () => {
  const steps = await run(await newEngine(), 'cloning');
  assert.ok(!modi(steps[1].r).includes('CLONING'));
  assert.ok(modi(steps[2].r).includes('CLONING') && modi(steps[4].r).includes('CLONING'));
});
test('upcoding, prolonged LOS, unbundling, repeat billing', async () => {
  const e = await newEngine();
  assert.ok(modi((await run(e, 'upcoding'))[0].r).includes('UPCODING'));
  assert.ok(modi((await run(e, 'prolonged_los'))[0].r).includes('PROLONGED_LOS'));
  assert.ok(modi((await run(e, 'unbundling'))[1].r).includes('UNBUNDLING'));
  assert.ok(modi((await run(e, 'repeat_billing'))[1].r).includes('REPEAT_BILLING'));
});
test('kunjungan ulang sah (jarak > jendela) tidak ditandai', async () => {
  const e = await newEngine();
  const rng = makeRng(5); const p = new PatientFactory(rng).next();
  const c1 = baseClaim(rng, p, 'RS-A', '2026-07-01', { dx: 'I10' });
  const c2 = baseClaim(rng, p, 'RS-B', addDays('2026-07-01', 20), { dx: 'J18.9' });
  await e.analyze({ claim_id: 'X1', facility_id: 'RS-A', fraud_ref: p.patient_nik, ...c1 });
  const r = await e.analyze({ claim_id: 'X2', facility_id: 'RS-B', fraud_ref: p.patient_nik, ...c2 });
  assert.ok(!modi(r).includes('SELF_REFERRAL'));
});
test('analisis idempoten (replay mengembalikan hasil sama, tidak menggandakan kasus)', async () => {
  const e = await newEngine();
  const [{ it, r }] = await run(e, 'upcoding');
  const again = await e.analyze({ claim_id: r.claim_id, facility_id: it.facility_id, fraud_ref: it.claim.patient_nik, ...it.claim });
  assert.equal(again.replay, true); assert.equal(again.risk_score, r.risk_score);
  assert.equal((await e.stats()).total_cases, 1);
});
test('human-in-the-loop: review mengubah status & tercatat', async () => {
  const e = await newEngine();
  const [{ r }] = await run(e, 'upcoding');
  const c = await e.review(r.case_id, { decision: 'CONFIRMED_FRAUD', note: 'Dokumen pendukung tidak ada', reviewer: 'v1' });
  assert.equal(c.status, 'TERKONFIRMASI'); assert.equal(c.reviews.length, 1);
  assert.equal(await e.review('CASE-nope', { decision: 'NEEDS_MORE_INFO', note: 'x', reviewer: 'v1' }), null);
  assert.equal((await e.stats()).review_precision, 1);
});
test('hasil identik untuk token maupun identitas asli (paritas baseline vs proposed)', async () => {
  const items = buildDataset({ seed: 77, normal: 40 });
  const a = await newEngine(); const b = await newEngine();
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const ra = await a.analyze({ claim_id: `A${i}`, facility_id: it.facility_id, fraud_ref: it.claim.patient_nik, ...it.claim });
    const rb = await b.analyze({ claim_id: `B${i}`, facility_id: it.facility_id, fraud_ref: `PSE_FRD_${it.claim.patient_nik}`, ...it.claim });
    assert.equal(ra.risk_score, rb.risk_score); assert.deepEqual(modi(ra), modi(rb));
  }
});
test('noisy-OR & level risiko', () => {
  assert.equal(noisyOr([]), 0); assert.equal(noisyOr([50]), 50); assert.equal(noisyOr([50, 50]), 75);
  assert.equal(riskLevel(80), 'HIGH'); assert.equal(riskLevel(50), 'MEDIUM'); assert.equal(riskLevel(25), 'LOW'); assert.equal(riskLevel(5), 'NONE');
});
test('Isolation Forest: deterministik & outlier berskor lebih tinggi', () => {
  const rng = makeRng(3); const X = Array.from({ length: 300 }, () => [1 + (rng() - 0.5) * 0.2, 1 + (rng() - 0.5) * 0.2]);
  const f1 = new IsolationForest({ seed: 1 }).fit(X); const f2 = new IsolationForest({ seed: 1 }).fit(X);
  assert.equal(f1.score([1, 1]), f2.score([1, 1]));
  assert.ok(f1.score([4, 4]) > 0.6 && f1.score([4, 4]) > f1.score([1, 1]) + 0.1);
});
