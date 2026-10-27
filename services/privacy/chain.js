// Rantai hash audit: hash = SHA-256(isi entri termasuk seq & hash_prev). Mengubah, menghapus, atau menyisipkan entri memutus rantai.
import crypto from 'node:crypto';

export const GENESIS = '0'.repeat(64);

const canonical = (entry) => JSON.stringify(Object.fromEntries(
  Object.entries(entry).filter(([k, v]) => k !== 'hash' && k !== 'id' && v !== undefined && v !== null).sort(([a], [b]) => (a < b ? -1 : 1)),
));
export const computeHash = (entry) => crypto.createHash('sha256').update(canonical(entry)).digest('hex');

export function verifyChain(rows) {
  const chain = rows.filter((r) => r.hash).sort((a, b) => a.seq - b.seq);
  let prev = GENESIS;
  for (const [i, r] of chain.entries()) {
    if (r.seq !== i + 1 || r.hash_prev !== prev || computeHash(r) !== r.hash) return { valid: false, entries: chain.length, broken_at: r.seq };
    prev = r.hash;
  }
  return { valid: true, entries: chain.length };
}
