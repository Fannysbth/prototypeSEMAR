// npm run seed-demo : isi antrian kasus dengan data awal yang bervariasi (skor, tingkat risiko, modus, status, dan umur kasus berbeda).
//  1) unggah demo/seed_oktober.csv lewat gateway (tokenisasi dan deteksi seperti biasa)
//  2) ubah status sebagian kasus lewat API (tercatat di audit_log) dan buat penjelasan sebagian kasus
//  3) hentikan layanan, lalu mundurkan waktu kasus dan riwayat statusnya langsung di penyimpanan (satu-satunya cara memberi umur)
// Hanya untuk demo: stempel waktu kasus dimundurkan, sedangkan baris audit tetap bertanggal hari ini. Batch demo November
// (demo/fkrtl_batch_november_*.csv) sengaja tidak diunggah di sini; itu diunggah langsung saat demo.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, getConfig } from '../shared/config.js';
import { createStore } from '../shared/store.js';
import { startStack } from './stack.js';

const config = getConfig();
const HOUR = 3600000; const DAY = 24 * HOUR;
// Rencana deterministik: urutan status menurut peringkat skor, umur diacak dengan langkah tetap agar tidak berkorelasi dengan skor.
const STATUS_PLAN = ['BARU', 'DITINJAU', 'BARU', 'BUTUH_INFO', 'MENUNGGU_FASKES', 'ESKALASI', 'BARU', 'TERKONFIRMASI', 'DITINJAU', 'DITOLAK_FALSE_POSITIVE', 'BARU', 'SELESAI'];
const AGES = [0.4 * HOUR, 2 * HOUR, 5 * HOUR, 20 * HOUR, 1.5 * DAY, 2.5 * DAY, 3.5 * DAY, 5 * DAY, 7 * DAY, 10 * DAY, 14 * DAY, 21 * DAY];
const NOTES = {
  DITINJAU: 'Sedang ditelaah dari pola token lintas faskes.', BUTUH_INFO: 'Perlu informasi tambahan dari faskes.', MENUNGGU_FASKES: 'Menunggu berkas dari faskes.',
  ESKALASI: 'Diteruskan ke auditor.', TERKONFIRMASI: 'Berkas faskes tidak menjelaskan pola yang ditandai.', DITOLAK_FALSE_POSITIVE: 'Berkas faskes menjelaskan pola tersebut; bukan kecurangan.', SELESAI: 'Ditutup setelah tindak lanjut.',
};

// ML dimatikan khusus seed: model supervised dilatih dari generator yang sama sehingga menjenuhkan skor (96-100) dan menyeragamkan daftar.
// Kasus seed memakai skor aturan saja (ml_status 'disabled'); batch November yang diunggah langsung tetap memakai ML.
const stack = await startStack({ quiet: true, env: { ML_ENABLED: 'false' } });
let caseIds;
try {
  const call = async (p, init = {}, token) => {
    const res = await fetch(stack.baseUrl + p, { ...init, headers: { ...(init.body && !init.headers?.['content-type'] ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${p}: ${json.error?.message ?? res.status}`);
    return json;
  };
  const { token } = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'verifikator', password: 'demo-verifikator' }) });
  if (!token) throw new Error('Akun demo tidak tersedia (butuh DEMO_MODE=true)');
  const csv = fs.readFileSync(path.join(ROOT, 'demo', 'seed_oktober.csv'), 'utf8');
  const up = await call('/api/claims/upload', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv }, token);
  console.log(`Unggah seed: ${up.accepted} diterima, ${up.rejected} ditolak, ${up.cases} kasus`);

  const { items } = await call('/api/v1/cases?limit=500', {}, token);
  const ranked = items.filter((c) => c.claim_id.startsWith('FKL-OKT-')).sort((a, b) => b.risk_score - a.risk_score || a.case_id.localeCompare(b.case_id));
  for (const [i, c] of ranked.entries()) {
    const status = STATUS_PLAN[i % STATUS_PLAN.length];
    if (status !== 'BARU') await call(`/api/v1/cases/${encodeURIComponent(c.case_id)}`, { method: 'PATCH', body: JSON.stringify({ status, note: NOTES[status] }) }, token);
    if (i % 3 !== 2) await call(`/api/v1/cases/${encodeURIComponent(c.case_id)}/explain`, { method: 'POST', body: '{}' }, token);
  }
  caseIds = ranked.map((c) => c.case_id);
} finally { await stack.stop(); }

// Mundurkan waktu langsung di penyimpanan fraud (layanan sudah berhenti, jadi tidak ada penulis lain).
const store = await createStore({ driver: config.store.driver, namespace: 'fraud', dataDir: config.store.dataDir, databaseUrl: process.env.DATABASE_URL_FRAUD || config.store.databaseUrl });
const cases = await store.collection('cases', { indexes: ['status', 'risk_level'], numericIndexes: ['created_ms'] });
const events = await store.collection('case_events', { indexes: ['case_id'], numericIndexes: ['at_ms'] });
const now = Date.now();
for (const [i, id] of caseIds.entries()) {
  const created = now - AGES[(i * 5) % AGES.length];
  const evs = (await events.find({ eq: { case_id: id } }, { orderBy: 'at_ms', dir: 'asc' }));
  for (const [j, e] of evs.entries()) await events.update(e.id, { at_ms: Math.round(created + ((now - created) * j) / Math.max(1, evs.length)) });
  await cases.update(id, { created_ms: created, updated_ms: evs.length > 1 ? Math.round(created + ((now - created) * (evs.length - 1)) / evs.length) : created });
}
await store.close();
console.log(`Seed demo selesai: ${caseIds.length} kasus dengan skor, status, dan umur bervariasi.`);
