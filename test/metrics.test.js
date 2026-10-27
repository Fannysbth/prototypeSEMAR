// T3: metrik evaluasi. Nilai harapan dihitung tangan dari contoh kecil (bukan dihitung ulang dengan rumus yang sama).
import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityK, precisionAtK, recallAtK, liftAtK, rupiahRecallAtK, prAuc, rocAuc, bootstrapCI } from '../shared/metrics.js';

// peringkat: 0.9(+) 0.8 0.7(+) 0.6 0.5 0.4 0.3 0.2 0.1(+) 0.0
const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
const labels = [1, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const excess = [100, 0, 300, 0, 0, 0, 0, 0, 600, 0];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);

test('kapasitas k dibulatkan ke atas dan minimal 1', () => {
  assert.equal(capacityK(10, 0.01), 1);
  assert.equal(capacityK(1000, 0.01), 10);
  assert.equal(capacityK(250, 0.01), 3);
});

test('precision, recall, dan lift pada top-k', () => {
  near(precisionAtK(scores, labels, 2), 0.5);
  near(recallAtK(scores, labels, 3), 2 / 3);
  near(liftAtK(scores, labels, 2), 0.5 / 0.3);
});

test('rupiah recall: porsi rupiah berlebih yang tertangkap di top-k', () => {
  near(rupiahRecallAtK(scores, labels, excess, 3), 0.4);
  near(rupiahRecallAtK(scores, labels, excess, 9), 1);
});

test('PR-AUC (average precision) dan ROC-AUC', () => {
  near(prAuc(scores, labels), (1 + 2 / 3 + 3 / 9) / 3);
  near(rocAuc(scores, labels), 14 / 21);
});

test('skor imbang diurutkan stabil menurut indeks, tidak memihak label', () => {
  near(precisionAtK([1, 1, 1], [0, 1, 0], 1), 0);
});

test('metrik tak terdefinisi tanpa positif mengembalikan null, bukan angka palsu', () => {
  assert.equal(recallAtK(scores, labels.map(() => 0), 3), null);
  assert.equal(rocAuc(scores, labels.map(() => 0)), null);
});

test('bootstrap CI per grup: ranking sempurna memberi interval [1, 1]; interval memuat estimasi titik', () => {
  const perfectScores = [0.9, 0.8, 0.1, 0.05, 0.04, 0.03];
  const perfectLabels = [1, 1, 0, 0, 0, 0];
  const groups = ['a', 'b', 'c', 'd', 'e', 'f'];
  const ci = bootstrapCI(perfectScores.length, groups, (idx) => prAuc(idx.map((i) => perfectScores[i]), idx.map((i) => perfectLabels[i])), { B: 100, seed: 1 });
  assert.deepEqual([ci.lo, ci.hi], [1, 1]);
  const noisy = bootstrapCI(scores.length, scores.map((_, i) => `g${i}`), (idx) => prAuc(idx.map((i) => scores[i]), idx.map((i) => labels[i])), { B: 200, seed: 1 });
  assert.ok(noisy.lo <= prAuc(scores, labels) && prAuc(scores, labels) <= noisy.hi);
});
