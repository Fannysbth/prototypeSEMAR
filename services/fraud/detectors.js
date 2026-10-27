// Detektor per modus kecurangan. Semuanya memakai HANYA token pasien (fraud_ref) + atribut klinis/klaim.
// Tidak ada detektor yang membutuhkan NIK/nama -> bekerja identik di mode baseline maupun proposed.
import { REFERENCE } from '../../shared/reference.js';

export const DAY = 86400000;
export const THRESHOLDS = {
  hopWindowDays: 7,        // jendela pencocokan lintas-faskes
  cloneWindowDays: 7,
  cloneMinPatients: 3,     // klaim identik dari >= 3 pasien berbeda di faskes sama
  unbundleDays: 2,
  repeatDays: 90,          // klaim ganda: diagnosis + tindakan + faskes + nominal sama dalam 90 hari
  upcodeRatio: 1.5,        // nominal >= 1.5x median referensi, atau
  upcodeZ: 4.5,            // robust z-score >= 4.5
  caseScore: 45,
  levels: { high: 70, medium: 45, low: 20 },
  mlFlag: 0.66,
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const uniq = (a) => [...new Set(a)];
const brief = (o) => ({ claim_id: o.claim_id, facility_id: o.facility_id, admit_date: o.admit_date, length_of_stay: o.length_of_stay, amount: o.amount });

export function selfReferral(obs, ctx, th) {
  const others = ctx.sameRef.filter((o) => o.facility_id !== obs.facility_id && Math.abs(o.admit_ms - obs.admit_ms) <= th.hopWindowDays * DAY);
  const facs = uniq([obs.facility_id, ...others.map((o) => o.facility_id)]).sort();
  if (facs.length < 2) return null;
  return {
    modus: 'SELF_REFERRAL', rule: 'cross_facility_hopping', score: facs.length >= 3 ? 82 : 48,
    reason: `Token pasien yang sama muncul di ${facs.length} faskes berbeda (${facs.join(', ')}) dalam ${th.hopWindowDays} hari. Perlu dicek kelengkapan alasan rujukan.`,
    evidence: { facilities: facs, other_claims: others.map(brief) },
  };
}

export function phantomBilling(obs, ctx) {
  const overlap = ctx.sameRef.filter((o) => o.facility_id !== obs.facility_id && o.admit_ms < obs.end_ms && obs.admit_ms < o.end_ms);
  if (!overlap.length) return null;
  return {
    modus: 'PHANTOM_BILLING', rule: 'overlapping_stay', score: 90,
    reason: `Periode layanan pasien yang sama tumpang tindih dengan klaim di ${uniq(overlap.map((o) => o.facility_id)).sort().join(', ')} - mustahil secara fisik berada di dua faskes sekaligus.`,
    evidence: { overlaps: overlap.map(brief) },
  };
}

export function cloning(obs, ctx, th) {
  const others = ctx.sameFp.filter((o) => o.fraud_ref !== obs.fraud_ref && Math.abs(o.admit_ms - obs.admit_ms) <= th.cloneWindowDays * DAY);
  const patients = uniq([obs.fraud_ref, ...others.map((o) => o.fraud_ref)]);
  if (patients.length < th.cloneMinPatients) return null;
  return {
    modus: 'CLONING', rule: 'identical_claim_fingerprint', score: patients.length >= 4 ? 85 : 75,
    reason: `${patients.length} klaim dari pasien berbeda di ${obs.facility_id} memiliki isi identik (diagnosis, tindakan, lama rawat, nominal) dalam ${th.cloneWindowDays} hari - indikasi salin-tempel klaim.`,
    evidence: { identical_claims: others.map(brief) },
  };
}

export function upcoding(obs) {
  const ref = REFERENCE[obs.diagnosis_code];
  if (!ref) return null;
  const ratio = obs.amount / ref.tariff_median;
  const z = (obs.amount - ref.tariff_median) / (1.4826 * ref.tariff_mad);
  if (ratio < THRESHOLDS.upcodeRatio && z < THRESHOLDS.upcodeZ) return null;
  return {
    modus: 'UPCODING', rule: 'amount_vs_reference', score: clamp(Math.round(40 + (ratio - 1.3) * 50), 45, 92),
    reason: `Nominal Rp${Math.round(obs.amount).toLocaleString('id-ID')} adalah ${ratio.toFixed(1)}x median referensi diagnosis ${obs.diagnosis_code} (Rp${ref.tariff_median.toLocaleString('id-ID')}).`,
    evidence: { ratio: +ratio.toFixed(2), robust_z: +z.toFixed(1), reference_median: ref.tariff_median, note: 'referensi sintetis, bukan tarif resmi' },
  };
}

export function prolongedLos(obs) {
  const ref = REFERENCE[obs.diagnosis_code];
  if (!ref || obs.length_of_stay <= ref.max_los) return null;
  const ratio = obs.length_of_stay / ref.expected_los;
  return {
    modus: 'PROLONGED_LOS', rule: 'los_vs_reference', score: clamp(Math.round(50 + (ratio - 2) * 8), 55, 85),
    reason: `Lama rawat ${obs.length_of_stay} hari melebihi batas wajar ${ref.max_los} hari untuk diagnosis ${obs.diagnosis_code} (rata-rata ${ref.expected_los} hari).`,
    evidence: { length_of_stay: obs.length_of_stay, expected: ref.expected_los, max: ref.max_los },
  };
}

export function unbundling(obs, ctx, th) {
  const ref = REFERENCE[obs.diagnosis_code];
  if (!ref) return null;
  const others = ctx.sameRef.filter((o) => o.facility_id === obs.facility_id && o.diagnosis_code === obs.diagnosis_code && Math.abs(o.admit_ms - obs.admit_ms) <= th.unbundleDays * DAY);
  if (!others.length) return null;
  const parts = [obs, ...others];
  if (parts.some((p) => p.amount > 0.75 * ref.tariff_median)) return null;
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (sum < 0.8 * ref.tariff_median || sum > 1.35 * ref.tariff_median) return null;
  return {
    modus: 'UNBUNDLING', rule: 'split_episode', score: 72,
    reason: `${parts.length} klaim kecil untuk pasien & diagnosis yang sama dalam ${th.unbundleDays} hari; totalnya Rp${Math.round(sum).toLocaleString('id-ID')} setara satu paket layanan (referensi Rp${ref.tariff_median.toLocaleString('id-ID')}).`,
    evidence: { parts: parts.map(brief), total: Math.round(sum) },
  };
}

export function repeatBilling(obs, ctx, th) {
  const dups = ctx.sameRef.filter((o) => o.facility_id === obs.facility_id && o.diagnosis_code === obs.diagnosis_code
    && (o.procedure_code || '') === (obs.procedure_code || '') && Math.abs(o.amount - obs.amount) < 1 && Math.abs(o.admit_ms - obs.admit_ms) <= th.repeatDays * DAY);
  if (!dups.length) return null;
  return {
    modus: 'REPEAT_BILLING', rule: 'duplicate_claim', score: 65,
    reason: `Klaim dengan diagnosis, tindakan, dan nominal identik untuk pasien yang sama sudah pernah ditagihkan di ${obs.facility_id} dalam ${th.repeatDays} hari terakhir.`,
    evidence: { previous: dups.map(brief) },
  };
}

export const ALL = [selfReferral, phantomBilling, cloning, upcoding, prolongedLos, unbundling, repeatBilling];
