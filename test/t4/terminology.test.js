// T4: istilah "rupiah kerugian" diganti "potensi nilai dipertanyakan (estimasi)" di API; rumus per modus sesuai tinjauan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../shared/store.js';
import { createEngine } from '../../services/fraud/engine.js';
import { simulateImpact, impactSchema } from '../../services/gateway/impact.js';

const base = { fraud_ref: 'PSE_FRD_AAAAAAAAAAAAAAAAAAAA', claim_type: 'RI', length_of_stay: 4 };
async function engine() {
  const st = await createStore({ driver: 'memory', namespace: 'term' });
  return createEngine({ observations: await st.collection('o'), cases: await st.collection('c') });
}

test('klaim ganda: nilai dipertanyakan = tagihan klaim kedua', async () => {
  const e = await engine();
  const c = { ...base, facility_id: 'RS-A', diagnosis_code: 'J18.9', procedure_code: '87.44', amount: 6200000 };
  await e.analyze({ ...c, claim_id: 'T-1', admit_date: '2026-03-01' });
  const r = await e.analyze({ ...c, claim_id: 'T-2', admit_date: '2026-04-15' });
  const kasus = await e.getCase(r.case_id);
  assert.equal(kasus.potensi_nilai_dipertanyakan, 6200000);
  assert.ok(!('excess_amount' in kasus));
});

test('upcoding: nilai dipertanyakan = selisih terhadap median tarif diagnosis yang sama', async () => {
  const e = await engine();
  const r = await e.analyze({ ...base, claim_id: 'T-3', facility_id: 'RS-A', diagnosis_code: 'J18.9', procedure_code: '87.44', admit_date: '2026-03-01', amount: 13200000 });
  assert.equal((await e.getCase(r.case_id)).potensi_nilai_dipertanyakan, 13200000 - 6200000);
});

test('statistik memakai nama baru', async () => {
  const e = await engine();
  await e.analyze({ ...base, claim_id: 'T-4', facility_id: 'RS-A', diagnosis_code: 'J18.9', procedure_code: '87.44', admit_date: '2026-03-01', amount: 13200000 });
  const s = await e.stats();
  assert.equal(s.potensi_nilai_dipertanyakan_total, 7000000);
  assert.ok(!('excess_total' in s));
});

test('simulasi dampak: nama hasil memakai istilah baru dan tetap berlabel asumsi', () => {
  const r = simulateImpact(impactSchema.parse({ annual_claim_value: 1e12, fraud_rate: 0.03, rupiah_recall: 0.4, recovery_rate: 0.5, biaya_operasional: 1e9 }));
  assert.equal(r.result.potensi_nilai_dipertanyakan_rp, 3e10);
  assert.equal(r.result.nilai_terdeteksi_rp, 1.2e10);
  assert.ok(!('potensi_fraud_rp' in r.result) && !('fraud_terjaring_rp' in r.result));
  assert.ok(r.assumptions.some((a) => /asumsi/i.test(a)));
});
