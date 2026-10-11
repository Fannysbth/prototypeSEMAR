// Isolation Forest (Liu et al., 2008) - implementasi murni JS, berbenih (deterministik).
// Cocok sebagai AI tepat guna di sini: TIDAK butuh label fraud (yang tidak tersedia),
// bekerja pada fitur non-identitas, dan skornya bisa dijelaskan lewat fitur pembentuknya.
import { makeRng } from '../../shared/synthetic.js';

const EULER = 0.5772156649;
const cFactor = (n) => (n <= 1 ? 0 : n === 2 ? 1 : 2 * (Math.log(n - 1) + EULER) - (2 * (n - 1)) / n);

export class IsolationForest {
  constructor({ nTrees = 100, sampleSize = 256, seed = 42 } = {}) {
    this.nTrees = nTrees; this.sampleSize = sampleSize; this.seed = seed; this.trees = []; this.c = 1;
  }

  fit(X) {
    const rng = makeRng(this.seed);
    const psi = Math.min(this.sampleSize, X.length);
    const maxDepth = Math.ceil(Math.log2(Math.max(2, psi)));
    const dims = X[0].length;
    const build = (rows, depth) => {
      if (depth >= maxDepth || rows.length <= 1) return { size: rows.length };
      for (let attempt = 0; attempt < dims * 2; attempt += 1) {
        const q = Math.floor(rng() * dims);
        let lo = Infinity; let hi = -Infinity;
        for (const r of rows) { if (r[q] < lo) lo = r[q]; if (r[q] > hi) hi = r[q]; }
        if (lo === hi) continue;
        const p = lo + rng() * (hi - lo);
        return { q, p, l: build(rows.filter((r) => r[q] < p), depth + 1), r: build(rows.filter((r) => r[q] >= p), depth + 1) };
      }
      return { size: rows.length };
    };
    this.trees = [];
    for (let t = 0; t < this.nTrees; t += 1) {
      const idx = X.map((_, i) => i);
      for (let i = 0; i < psi; i += 1) { const j = i + Math.floor(rng() * (idx.length - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      this.trees.push(build(idx.slice(0, psi).map((i) => X[i]), 0));
    }
    this.c = cFactor(psi);
    return this;
  }

  score(x) {
    const path = (node, depth) => (node.size !== undefined ? depth + cFactor(node.size) : path(x[node.q] < node.p ? node.l : node.r, depth + 1));
    let sum = 0;
    for (const t of this.trees) sum += path(t, 0);
    return 2 ** (-(sum / this.trees.length) / this.c);
  }
}
