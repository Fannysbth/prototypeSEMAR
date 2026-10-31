// Membuat demo/fkrtl_batch_november.csv (deterministik, SINTETIS): rawat inap tumpang tindih lintas 2 RS,
// cloning di 2 RS, dan klaim wajar sebagai latar. Dipakai pada demo unggah CSV oleh faskes/verifikator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PatientFactory, SCENARIOS, addDays, baseClaim, makeRng } from '../shared/synthetic.js';
import { toCsv } from '../shared/csv.js';
import { CLAIM_COLUMNS } from './generate-data/index.js';

const rng = makeRng(2611);
const pf = new PatientFactory(rng);
const rows = [];
const add = (facility_id, claim) => rows.push({ claim_ref: `FKL-NOV-${String(rows.length + 1).padStart(4, '0')}`, facility_id, ...claim });

for (let i = 0; i < 30; i += 1) { const [it] = SCENARIOS.normal(rng, pf, addDays('2026-11-02', i % 16)); add(it.facility_id, it.claim); }
// Pasien yang sama dirawat inap di RS-A dan RS-B pada hari yang tumpang tindih (phantom billing lintas faskes).
const p = pf.next();
add('RS-A', baseClaim(rng, p, 'RS-A', '2026-11-04', { dx: 'J18.9', length_of_stay: 5 }));
add('RS-B', { ...baseClaim(rng, p, 'RS-B', '2026-11-05', { dx: 'J18.9', length_of_stay: 4 }), record_number: 'RM-B-NOV-001' });
// Cloning: klaim identik dari pasien berbeda, di RS-A dan di RS-B.
for (const fac of ['RS-A', 'RS-B']) {
  const tmpl = baseClaim(rng, pf.next(), fac, '2026-11-09', { dx: 'N39.0' });
  for (let i = 0; i < 4; i += 1) add(fac, { ...baseClaim(rng, pf.next(), fac, addDays('2026-11-09', i), { dx: 'N39.0', procedure_code: tmpl.procedure_code, length_of_stay: tmpl.length_of_stay, amount: tmpl.amount }), claim_type: tmpl.claim_type });
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'fkrtl_batch_november.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toCsv(rows, CLAIM_COLUMNS));
// Akun faskes hanya boleh mengunggah barisnya sendiri; berkas per faskes dipakai di demo, berkas gabungan untuk verifikator.
for (const fac of ['RS-A', 'RS-B']) fs.writeFileSync(out.replace('.csv', `_${fac}.csv`), toCsv(rows.filter((r) => r.facility_id === fac), CLAIM_COLUMNS));
console.log(`${rows.length} baris -> ${out} (+ berkas RS-A dan RS-B)`);

// Data awal (seed) terpisah dari batch November: kasus Oktober dengan skenario beragam (upcoding, lama rawat berlebih, unbundling,
// rujukan semu, klaim ganda) agar daftar kasus tidak seragam. Diunggah oleh npm run seed-demo, bukan saat demo unggah langsung.
const rng2 = makeRng(2610);
const pf2 = new PatientFactory(rng2);
const seed = [];
const addSeed = (facility_id, claim) => seed.push({ claim_ref: `FKL-OKT-${String(seed.length + 1).padStart(4, '0')}`, facility_id, ...claim });
for (let i = 0; i < 40; i += 1) { const [it] = SCENARIOS.normal(rng2, pf2, addDays('2026-10-01', i % 24)); addSeed(it.facility_id, it.claim); }
for (const [name, day] of [['upcoding', '2026-10-03'], ['upcoding', '2026-10-09'], ['upcoding', '2026-10-15'], ['prolonged_los', '2026-10-06'], ['prolonged_los', '2026-10-17'], ['unbundling', '2026-10-11'], ['self_referral', '2026-10-12'], ['self_referral', '2026-10-20'], ['repeat_billing', '2026-10-13'], ['phantom', '2026-10-08'], ['cloning', '2026-10-19']]) {
  for (const it of SCENARIOS[name](rng2, pf2, day)) addSeed(it.facility_id, it.claim);
}
fs.writeFileSync(out.replace('fkrtl_batch_november.csv', 'seed_oktober.csv'), toCsv(seed, CLAIM_COLUMNS));
console.log(`${seed.length} baris seed -> demo/seed_oktober.csv`);
