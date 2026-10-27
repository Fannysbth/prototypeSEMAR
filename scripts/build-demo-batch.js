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
