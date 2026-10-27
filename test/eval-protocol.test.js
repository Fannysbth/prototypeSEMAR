// T3: protokol evaluasi tidak boleh bocor. Split waktu, modus hold-out, hard negatives, dan seed deterministik.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvalDataset, HOLDOUT_MODUS, TRAIN_DAYS } from '../scripts/eval/dataset.js';

const opts = { peserta: 1500, seed: 11, fraudRate: 0.03, difficulty: 'standard' };

test('split berdasarkan waktu: semua klaim latih (bulan 1-4) lebih awal dari semua klaim uji (bulan 5-6)', () => {
  const { rows } = buildEvalDataset(opts);
  const train = rows.filter((r) => r.split === 'train'); const testSet = rows.filter((r) => r.split === 'test');
  assert.ok(train.length > 0 && testSet.length > 0);
  assert.ok(train.every((r) => r.day < TRAIN_DAYS) && testSet.every((r) => r.day >= TRAIN_DAYS));
  assert.equal(TRAIN_DAYS, 120);
});

test('modus hold-out tidak pernah dipakai melatih model supervised, tetapi ada di set uji', () => {
  const { rows } = buildEvalDataset(opts);
  assert.ok(rows.filter((r) => r.modus === HOLDOUT_MODUS && r.split === 'test').length > 0, 'hold-out harus muncul di uji');
  assert.ok(rows.filter((r) => r.modus === HOLDOUT_MODUS).every((r) => r.sup_train === false));
  assert.ok(rows.filter((r) => r.split === 'train' && r.modus !== HOLDOUT_MODUS).every((r) => r.sup_train === true));
});

test('hard negatives wajib ada di set uji dan berlabel wajar', () => {
  const { rows } = buildEvalDataset(opts);
  const hard = rows.filter((r) => r.split === 'test' && r.group === 'chronic_control');
  assert.ok(hard.length > 20);
  assert.ok(hard.every((r) => r.label === 0));
});

test('seed sama menghasilkan data identik; seed berbeda berbeda; tingkat sulit mengubah fraud, bukan klaim wajar', () => {
  const a = buildEvalDataset(opts); const b = buildEvalDataset(opts);
  assert.deepEqual(a.rows.map((r) => r.claim.amount), b.rows.map((r) => r.claim.amount));
  assert.notDeepEqual(a.rows.map((r) => r.claim.amount), buildEvalDataset({ ...opts, seed: 12 }).rows.map((r) => r.claim.amount));
  const hard = buildEvalDataset({ ...opts, difficulty: 'hard' });
  const norm = (d) => d.rows.filter((r) => !r.label && r.group === 'normal').map((r) => r.claim.amount);
  assert.deepEqual(norm(a), norm(hard));
  assert.ok(hard.rows.some((r) => r.label === 1));
});

test('klaim hard: fraud lebih halus, tagihan upcoding lebih rendah dari versi standar', () => {
  const mean = (d) => { const u = d.rows.filter((r) => r.modus === 'UPCODING'); return u.reduce((s, r) => s + r.claim.amount / r.ref_median, 0) / u.length; };
  assert.ok(mean(buildEvalDataset({ ...opts, peserta: 3000, difficulty: 'hard' })) < mean(buildEvalDataset({ ...opts, peserta: 3000 })) - 0.3);
});
