// SIMULASI DAMPAK RUPIAH. Murni aritmetika dari parameter masukan; asumsi ikut dikembalikan agar tidak ada klaim penghematan tanpa dasar.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../../shared/config.js';

const frac = z.number().min(0).max(1);
// Bentuk baru (docs/07): rupiah_recall. Bentuk lama (review_capacity + precision_at_k) tetap diterima agar klien lama tidak patah.
export const impactSchema = z.object({
  annual_claim_value: z.number().positive(), fraud_rate: frac, recovery_rate: frac,
  rupiah_recall: frac.optional(), review_capacity: frac.optional(), precision_at_k: frac.optional(),
  biaya_operasional: z.number().min(0).default(0),
}).strict().superRefine((v, ctx) => {
  const legacy = v.review_capacity !== undefined || v.precision_at_k !== undefined;
  if (v.rupiah_recall !== undefined && legacy) ctx.addIssue({ code: 'custom', path: ['rupiah_recall'], message: 'pakai rupiah_recall ATAU review_capacity + precision_at_k, jangan keduanya' });
  if (v.rupiah_recall === undefined && (v.review_capacity === undefined || v.precision_at_k === undefined)) ctx.addIssue({ code: 'custom', path: ['rupiah_recall'], message: 'rupiah_recall wajib diisi' });
});

const PILOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pilot-cost.json'), 'utf8'));
export const pilotCostPerYear = () => 12 * Object.values(PILOT.biaya_per_bulan_rp).reduce((a, b) => a + b, 0);

export function simulateImpact(p) {
  const potential = p.annual_claim_value * p.fraud_rate;
  const reviewed = p.annual_claim_value * (p.review_capacity ?? 0);
  const inQueue = p.rupiah_recall !== undefined ? potential * p.rupiah_recall : Math.min(potential, reviewed * p.precision_at_k);
  const recoverable = inQueue * p.recovery_rate;
  const net = recoverable - p.biaya_operasional;
  const direview = p.rupiah_recall === undefined ? { nilai_klaim_direview_rp: Math.round(reviewed) } : {};
  return {
    inputs: p,
    result: {
      potensi_fraud_rp: Math.round(potential), ...direview, fraud_terjaring_rp: Math.round(inQueue),
      potensi_pemulihan_rp: Math.round(recoverable), biaya_operasional_rp: p.biaya_operasional, potensi_penghematan_bersih_rp: Math.round(net),
      rasio_manfaat_biaya: p.biaya_operasional > 0 ? +(recoverable / p.biaya_operasional).toFixed(2) : null,
    },
    assumptions: [
      'Potensi fraud = nilai klaim tahunan x fraud_rate (fraud_rate adalah asumsi, bukan temuan).',
      'Terdeteksi = potensi fraud x rupiah_recall pada kapasitas review 1% klaim (angka dari npm run evaluate pada data sintetis; kapasitas 1% adalah asumsi).',
      'Pemulihan = fraud terjaring x recovery_rate (asumsi proporsi yang berhasil dipulihkan).',
      'Ini simulasi dari asumsi yang bisa diubah, bukan klaim penghematan.',
    ],
  };
}

// Tiga skenario (rendah, sedang, tinggi). Rupiah recall dari reports/metrics.json (min, rerata, maks antar-run evaluasi).
// Fraud rate, recovery rate, dan nilai klaim cabang adalah ASUMSI; biaya dari config/pilot-cost.json (docs/07).
const SCENARIO_ASSUMPTIONS = [
  { id: 'rendah', title: 'Rendah', fraud_rate: 0.01, recovery_rate: 0.2, key: 'low' },
  { id: 'sedang', title: 'Sedang', fraud_rate: 0.03, recovery_rate: 0.4, key: 'mid' },
  { id: 'tinggi', title: 'Tinggi', fraud_rate: 0.05, recovery_rate: 0.6, key: 'high' },
];
export function impactScenarios(metrics) {
  const recall = metrics?.impact_inputs?.rupiah_recall;
  if (!recall) return [];
  return SCENARIO_ASSUMPTIONS.map(({ id, title, fraud_rate, recovery_rate, key }) => {
    const inputs = impactSchema.parse({ annual_claim_value: PILOT.nilai_klaim_tahunan_cabang_rp, fraud_rate, rupiah_recall: recall[key], recovery_rate, biaya_operasional: pilotCostPerYear() });
    return { id, title, label: 'asumsi', inputs, result: simulateImpact(inputs), recall_source: 'reports/metrics.json (impact_inputs.rupiah_recall)' };
  });
}
