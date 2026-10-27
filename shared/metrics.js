// Metrik evaluasi peringkat (precision@k, recall@k, lift, rupiah recall, PR-AUC, ROC-AUC) dan bootstrap per grup.
// Skor imbang diurutkan menurut indeks agar urutan data tidak diuntungkan oleh label.
import { makeRng } from './synthetic.js';

export const capacityK = (n, capacity) => Math.max(1, Math.ceil(n * capacity));
const order = (scores) => scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
const positives = (labels) => labels.reduce((s, l) => s + (l ? 1 : 0), 0);

export function precisionAtK(scores, labels, k) {
  const top = order(scores).slice(0, k);
  return top.length ? top.filter((i) => labels[i]).length / top.length : null;
}
export function recallAtK(scores, labels, k) {
  const pos = positives(labels);
  return pos ? order(scores).slice(0, k).filter((i) => labels[i]).length / pos : null;
}
export function liftAtK(scores, labels, k) {
  const base = positives(labels) / labels.length;
  const p = precisionAtK(scores, labels, k);
  return base && p !== null ? p / base : null;
}
export function rupiahRecallAtK(scores, labels, excess, k) {
  const total = excess.reduce((s, x, i) => s + (labels[i] ? x : 0), 0);
  if (!total) return null;
  return order(scores).slice(0, k).reduce((s, i) => s + (labels[i] ? excess[i] : 0), 0) / total;
}
export function prAuc(scores, labels) {
  const pos = positives(labels);
  if (!pos) return null;
  let hit = 0; let ap = 0;
  order(scores).forEach((i, rank) => { if (labels[i]) { hit += 1; ap += hit / (rank + 1); } });
  return ap / pos;
}
export function rocAuc(scores, labels) {
  const pos = positives(labels); const neg = labels.length - pos;
  if (!pos || !neg) return null;
  let wins = 0;
  scores.forEach((s, i) => { if (!labels[i]) return; scores.forEach((t, j) => { if (!labels[j]) wins += s > t ? 1 : s === t ? 0.5 : 0; }); });
  return wins / (pos * neg);
}

// Resampling per grup (mis. per peserta) karena klaim satu peserta saling berkaitan. stat(indeks[]) -> angka atau null.
export function bootstrapCI(n, groups, stat, { B = 300, seed = 1, alpha = 0.05 } = {}) {
  const rng = makeRng(seed);
  const byGroup = new Map();
  for (let i = 0; i < n; i += 1) { if (!byGroup.has(groups[i])) byGroup.set(groups[i], []); byGroup.get(groups[i]).push(i); }
  const members = [...byGroup.values()];
  const draws = [];
  for (let b = 0; b < B; b += 1) {
    const idx = [];
    for (let g = 0; g < members.length; g += 1) idx.push(...members[Math.floor(rng() * members.length)]);
    const v = stat(idx);
    if (v !== null && v !== undefined) draws.push(v);
  }
  if (!draws.length) return { lo: null, hi: null };
  draws.sort((a, b) => a - b);
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))];
  return { lo: at(alpha / 2), hi: at(1 - alpha / 2) };
}
