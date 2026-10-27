// T3: simulasi dampak sesuai rumus docs/07-model-bisnis.md dan tiga skenario berbasis hasil evaluasi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateImpact, impactSchema, impactScenarios } from '../services/gateway/impact.js';

test('rumus 07-model-bisnis: tidak wajar -> terdeteksi (rupiah recall) -> tertahan (recovery) -> manfaat bersih', () => {
  const r = simulateImpact(impactSchema.parse({ annual_claim_value: 1e12, fraud_rate: 0.03, rupiah_recall: 0.4, recovery_rate: 0.5, biaya_operasional: 1e9 }));
  assert.equal(r.result.potensi_fraud_rp, 3e10);
  assert.equal(r.result.fraud_terjaring_rp, 1.2e10);
  assert.equal(r.result.potensi_pemulihan_rp, 6e9);
  assert.equal(r.result.potensi_penghematan_bersih_rp, 5e9);
  assert.equal(r.result.rasio_manfaat_biaya, 6);
});

test('parameter di luar 0..1 ditolak, dan rupiah_recall tidak boleh bersama parameter lama', () => {
  assert.throws(() => impactSchema.parse({ annual_claim_value: 1e12, fraud_rate: 0.03, rupiah_recall: 1.2, recovery_rate: 0.5 }));
  assert.throws(() => impactSchema.parse({ annual_claim_value: 1e12, fraud_rate: 0.03, rupiah_recall: 0.4, precision_at_k: 0.5, review_capacity: 0.01, recovery_rate: 0.5 }));
});

test('tiga skenario memakai rupiah recall hasil evaluasi, biaya pilot 11,3 juta/bulan, dan semuanya berlabel asumsi', () => {
  const metrics = { impact_inputs: { rupiah_recall: { low: 0.2, mid: 0.3, high: 0.5 } } };
  const s = impactScenarios(metrics);
  assert.deepEqual(s.map((x) => x.id), ['rendah', 'sedang', 'tinggi']);
  assert.deepEqual(s.map((x) => x.inputs.rupiah_recall), [0.2, 0.3, 0.5]);
  assert.ok(s.every((x) => x.inputs.biaya_operasional === 135600000 && x.label === 'asumsi'));
  // sedang: 4e12 x 3% x 0,3 x 0,4 = 14,4 miliar, dikurangi biaya setahun 135,6 juta
  assert.equal(s[1].result.result.potensi_penghematan_bersih_rp, 14264400000);
});
