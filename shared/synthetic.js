// Generator data SINTETIS berbenih (deterministik). Tidak ada satu pun data JKN riil.
// NIK sintetis selalu berawalan "9999" (kode provinsi 99 tidak ada -> pasti bukan NIK nyata).
import { REFERENCE, DIAGNOSES, FACILITIES } from './reference.js';

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const round100 = (n) => Math.round(n / 100) * 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const FIRST = ['Budi', 'Siti', 'Agus', 'Dewi', 'Rina', 'Hendra', 'Wulan', 'Joko', 'Putri', 'Andi', 'Maya', 'Dimas', 'Lestari', 'Fajar', 'Ayu', 'Rizky', 'Nur', 'Bayu', 'Intan', 'Yoga'];
const LAST = ['Santoso', 'Wijaya', 'Pratama', 'Nugroho', 'Saputra', 'Hidayat', 'Kusuma', 'Rahayu', 'Setiawan', 'Permana', 'Utami', 'Firmansyah', 'Anggraini', 'Maulana', 'Susanto'];

export class PatientFactory {
  constructor(rng) { this.rng = rng; this.used = new Set(); this.n = 0; }
  next() {
    const r = this.rng;
    let nik;
    do { nik = `9999${String(int(r, 100000000000, 999999999999))}`; } while (this.used.has(nik));
    this.used.add(nik);
    this.n += 1;
    return {
      patient_nik: nik,
      patient_name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      phone: `08${String(int(r, 1000000000, 9999999999))}`,
      birth_date: `${int(r, 1940, 2015)}-${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`,
      idx: this.n,
    };
  }
}

const rmFor = (p, facilityId) => `RM-${facilityId.slice(-1)}-${String(p.idx * 7919 % 1000000).padStart(6, '0')}`;

export function baseClaim(rng, patient, facilityId, admitDate, o = {}) {
  const dx = o.dx ?? pick(rng, DIAGNOSES);
  const ref = REFERENCE[dx];
  const los = o.length_of_stay ?? (ref.expected_los === 1 ? 1 : clamp(ref.expected_los + int(rng, -1, 1), 1, ref.max_los));
  const noise = clamp(1 + gauss(rng) * 0.07, 0.82, 1.18);
  return {
    patient_nik: patient.patient_nik, patient_name: patient.patient_name, phone: patient.phone,
    birth_date: patient.birth_date, record_number: rmFor(patient, facilityId),
    diagnosis_code: dx,
    procedure_code: o.procedure_code ?? pick(rng, ref.procedures),
    claim_type: los >= 2 ? 'RI' : 'RJ',
    admit_date: admitDate,
    length_of_stay: los,
    amount: o.amount ?? round100(ref.tariff_median * noise),
  };
}

const F = (rng, n) => {
  const pool = [...FACILITIES];
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = int(rng, 0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n).map((f) => f.id);
};
const lab = (fraud, modus, group) => ({ fraud, modus: modus ?? null, group });

// ---- Skenario (dipakai dataset evaluasi DAN tombol simulasi di UI). Tiap skenario mengembalikan klaim berurutan ----
export const SCENARIOS = {
  normal: (rng, pf, d) => {
    const f = pick(rng, FACILITIES).id;
    return [{ step: 'Klaim wajar', facility_id: f, claim: baseClaim(rng, pf.next(), f, d), label: lab(false, null, 'normal') }];
  },
  self_referral: (rng, pf, d) => {
    const p = pf.next(); const [a, b, c] = F(rng, 3); const dx = pick(rng, ['I10', 'J45.9', 'K29.7']);
    return [
      { step: `Hari 1 - ${a}`, facility_id: a, claim: baseClaim(rng, p, a, d, { dx, length_of_stay: 1 }), label: lab(false, null, 'self_referral_seed') },
      { step: `Hari 2 - ${b}`, facility_id: b, claim: baseClaim(rng, p, b, addDays(d, 1), { dx, length_of_stay: 1 }), label: lab(true, 'SELF_REFERRAL', 'self_referral') },
      { step: `Hari 3 - ${c}`, facility_id: c, claim: baseClaim(rng, p, c, addDays(d, 2), { dx, length_of_stay: 1 }), label: lab(true, 'SELF_REFERRAL', 'self_referral') },
    ];
  },
  phantom: (rng, pf, d) => {
    const p = pf.next(); const [a, b] = F(rng, 2); const dx = pick(rng, ['J18.9', 'A90', 'K35.8']);
    return [
      { step: `Rawat inap 4 hari - ${a}`, facility_id: a, claim: baseClaim(rng, p, a, d, { dx, length_of_stay: 4 }), label: lab(false, null, 'phantom_seed') },
      { step: `Rawat bersamaan - ${b}`, facility_id: b, claim: baseClaim(rng, p, b, addDays(d, 1), { dx, length_of_stay: 3 }), label: lab(true, 'PHANTOM_BILLING', 'phantom') },
    ];
  },
  cloning: (rng, pf, d) => {
    const [f] = F(rng, 1); const dx = pick(rng, ['A09', 'N39.0', 'E11.9']);
    const tmpl = baseClaim(rng, pf.next(), f, d, { dx });
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      const p = pf.next();
      out.push({
        step: `Klaim identik #${i + 1} - ${f}`, facility_id: f,
        claim: { ...baseClaim(rng, p, f, addDays(d, i), { dx, procedure_code: tmpl.procedure_code, length_of_stay: tmpl.length_of_stay, amount: tmpl.amount }), claim_type: tmpl.claim_type },
        label: i >= 2 ? lab(true, 'CLONING', 'cloning') : lab(false, null, 'cloning_seed'),
      });
    }
    return out;
  },
  upcoding: (rng, pf, d) => {
    const f = pick(rng, FACILITIES).id; const dx = pick(rng, DIAGNOSES.filter((x) => REFERENCE[x].expected_los >= 3));
    const mult = 2.1 + rng() * 1.1;
    return [{ step: `Tagihan ${mult.toFixed(1)}x referensi - ${f}`, facility_id: f, claim: baseClaim(rng, pf.next(), f, d, { dx, amount: round100(REFERENCE[dx].tariff_median * mult) }), label: lab(true, 'UPCODING', 'upcoding') }];
  },
  unbundling: (rng, pf, d) => {
    const p = pf.next(); const f = pick(rng, FACILITIES).id; const dx = pick(rng, ['J18.9', 'K35.8', 'I21.9']); const med = REFERENCE[dx].tariff_median;
    return [
      { step: `Klaim bagian 1 - ${f}`, facility_id: f, claim: baseClaim(rng, p, f, d, { dx, length_of_stay: 1, amount: round100(med * 0.5) }), label: lab(false, null, 'unbundling_seed') },
      { step: `Klaim bagian 2 (pecahan) - ${f}`, facility_id: f, claim: baseClaim(rng, p, f, addDays(d, 1), { dx, length_of_stay: 1, amount: round100(med * 0.52) }), label: lab(true, 'UNBUNDLING', 'unbundling') },
    ];
  },
  repeat_billing: (rng, pf, d) => {
    const p = pf.next(); const f = pick(rng, FACILITIES).id; const dx = pick(rng, DIAGNOSES.filter((x) => REFERENCE[x].expected_los >= 2));
    const first = baseClaim(rng, p, f, d, { dx });
    return [
      { step: `Klaim awal - ${f}`, facility_id: f, claim: first, label: lab(false, null, 'repeat_seed') },
      { step: `Klaim yang sama ditagih ulang (+10 hari) - ${f}`, facility_id: f, claim: { ...first, admit_date: addDays(d, 10) }, label: lab(true, 'REPEAT_BILLING', 'repeat') },
    ];
  },
  prolonged_los: (rng, pf, d) => {
    const f = pick(rng, FACILITIES).id; const dx = pick(rng, DIAGNOSES.filter((x) => REFERENCE[x].expected_los >= 3)); const ref = REFERENCE[dx];
    const los = ref.max_los + int(rng, 3, 6);
    return [{ step: `Rawat ${los} hari (wajar ${ref.expected_los}) - ${f}`, facility_id: f, claim: baseClaim(rng, pf.next(), f, d, { dx, length_of_stay: los, amount: round100(ref.tariff_median * 1.25) }), label: lab(true, 'PROLONGED_LOS', 'prolonged') }];
  },
};

export const SCENARIO_META = {
  normal: 'Klaim wajar (pembanding)',
  self_referral: 'Rujukan semu lintas-faskes (pasien sama di 3 RS)',
  phantom: 'Klaim hantu: rawat tumpang tindih di 2 RS',
  cloning: 'Cloning: 5 klaim identik dari pasien berbeda',
  upcoding: 'Upcoding: tagihan jauh di atas referensi',
  unbundling: 'Unbundling: satu paket dipecah jadi 2 klaim',
  repeat_billing: 'Klaim berulang (ditagih dua kali)',
  prolonged_los: 'Lama rawat memanjang tanpa indikasi',
};

// ---- Dataset berlabel untuk evaluasi/pelatihan ----
// chronic: jumlah pasien kronis wajar (hard negative: sering kontrol di faskes sama, jarak 10-14 hari). fraudScale: pengali jumlah skenario fraud.
export function buildDataset({ seed = 2026, normal = 220, base = '2026-06-01', fraud = true, chronic = 0, fraudScale = 1 } = {}) {
  const rng = makeRng(seed);
  const pf = new PatientFactory(rng);
  const items = [];
  let seq = 0;
  const push = (x) => items.push({ ...x, seq: seq++ });

  for (let i = 0; i < normal; i += 1) {
    const day = int(rng, 0, 80);
    const [item] = SCENARIOS.normal(rng, pf, addDays(base, day));
    push(item);
    const r = rng();
    if (r < 0.15) { // kunjungan ulang di faskes sama, jauh hari, diagnosis berbeda
      const dx2 = pick(rng, DIAGNOSES.filter((d) => d !== item.claim.diagnosis_code));
      const claim = baseClaim(rng, { ...item.claim, idx: 0 }, item.facility_id, addDays(base, day + int(rng, 35, 60)), { dx: dx2 });
      push({ step: 'Kunjungan ulang', facility_id: item.facility_id, claim: { ...claim, patient_nik: item.claim.patient_nik, patient_name: item.claim.patient_name, phone: item.claim.phone, birth_date: item.claim.birth_date, record_number: item.claim.record_number }, label: lab(false, null, 'normal') });
    } else if (r < 0.23) { // rujukan sah ke faskes lain >= 15 hari kemudian
      const other = pick(rng, FACILITIES.filter((f) => f.id !== item.facility_id)).id;
      const claim = baseClaim(rng, { ...item.claim, idx: 0 }, other, addDays(base, day + int(rng, 15, 40)));
      push({ step: 'Rujukan sah', facility_id: other, claim: { ...claim, patient_nik: item.claim.patient_nik, patient_name: item.claim.patient_name, phone: item.claim.phone, birth_date: item.claim.birth_date, record_number: `RM-${other.slice(-1)}-X${item.claim.patient_nik.slice(-5)}` }, label: lab(false, null, 'normal') });
    }
  }
  for (let i = 0; i < chronic; i += 1) {
    const f = pick(rng, FACILITIES).id; const dx = pick(rng, ['I10', 'E11.9']);
    const p = pf.next();
    let day = int(rng, 0, 30);
    for (let v = 0; v < 4; v += 1) {
      push({ step: v === 0 ? 'Kontrol rutin kronis' : `Kontrol rutin #${v + 1}`, facility_id: f, claim: { ...baseClaim(rng, p, f, addDays(base, day), { dx, length_of_stay: 1 }), claim_type: 'RJ' }, label: lab(false, null, 'chronic_control') });
      day += int(rng, 10, 14);
    }
  }
  if (fraud) {
    const groups = { self_referral: 8, phantom: 8, cloning: 4, upcoding: 12, unbundling: 8, repeat_billing: 8, prolonged_los: 6 };
    for (const [name, base_n] of Object.entries(groups)) {
      const n = Math.max(1, Math.round(base_n * fraudScale));
      for (let i = 0; i < n; i += 1) {
        for (const item of SCENARIOS[name](rng, pf, addDays(base, int(rng, 5, 70)))) push(item);
      }
    }
  }
  items.sort((a, b) => a.claim.admit_date.localeCompare(b.claim.admit_date) || a.seq - b.seq);
  return items;
}
