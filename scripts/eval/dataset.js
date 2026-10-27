// Dataset evaluasi: generator sintetis + split waktu (hari 0-119 latih, 120-179 uji) + penanda hold-out untuk model supervised.
import { generateDataset, HOLDOUT_MODUS } from '../generate-data/index.js';
import { REFERENCE } from '../../shared/reference.js';

export { HOLDOUT_MODUS };
export const SPAN_DAYS = 180;
export const TRAIN_DAYS = 120;
const DAY_MS = 86400000;

export function buildEvalDataset({ peserta = 3000, seed = 42, fraudRate = 0.03, difficulty = 'standard', base = '2026-06-01' } = {}) {
  const d = generateDataset({ peserta, seed, fraudRate, base, span: SPAN_DAYS, difficulty });
  const t0 = Date.parse(`${base}T00:00:00Z`);
  const rows = d.items.map((it, i) => {
    const t = d.truth[i];
    const day = Math.round((Date.parse(`${it.claim.admit_date}T00:00:00Z`) - t0) / DAY_MS);
    const split = day < TRAIN_DAYS ? 'train' : 'test';
    return {
      claim_ref: t.claim_ref, facility_id: it.facility_id, claim: it.claim, label: t.label, modus: t.modus || null, group: t.group,
      excess: t.excess_rupiah, day, split, sup_train: split === 'train' && t.modus !== HOLDOUT_MODUS,
      ref_median: REFERENCE[it.claim.diagnosis_code]?.tariff_median,
    };
  });
  return { rows, params: { ...d.params, train_days: TRAIN_DAYS }, truth: d.truth };
}
