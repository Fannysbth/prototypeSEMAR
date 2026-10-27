// SIMULASI DAMPAK RUPIAH. Murni aritmetika dari parameter masukan; asumsi ikut dikembalikan agar tidak ada klaim penghematan tanpa dasar.
import { z } from 'zod';

const frac = z.number().min(0).max(1);
export const impactSchema = z.object({
  annual_claim_value: z.number().positive(), fraud_rate: frac, review_capacity: frac, precision_at_k: frac, recovery_rate: frac,
  biaya_operasional: z.number().min(0).default(0),
}).strict();

export function simulateImpact(p) {
  const potential = p.annual_claim_value * p.fraud_rate;
  const reviewed = p.annual_claim_value * p.review_capacity;
  const inQueue = Math.min(potential, reviewed * p.precision_at_k);
  const recoverable = inQueue * p.recovery_rate;
  const net = recoverable - p.biaya_operasional;
  return {
    inputs: p,
    result: {
      potensi_fraud_rp: Math.round(potential), nilai_klaim_direview_rp: Math.round(reviewed), fraud_terjaring_rp: Math.round(inQueue),
      potensi_pemulihan_rp: Math.round(recoverable), biaya_operasional_rp: p.biaya_operasional, potensi_penghematan_bersih_rp: Math.round(net),
      rasio_manfaat_biaya: p.biaya_operasional > 0 ? +(recoverable / p.biaya_operasional).toFixed(2) : null,
    },
    assumptions: [
      'Potensi fraud = nilai klaim tahunan x fraud_rate (fraud_rate adalah asumsi, bukan temuan).',
      'Kapasitas review = review_capacity x nilai klaim; klaim fraud diasumsikan bernilai rata-rata sama dengan klaim lain.',
      'Fraud terjaring = nilai klaim direview x precision_at_k, dibatasi potensi fraud. Isi precision_at_k dari keluaran npm run evaluate.',
      'Pemulihan = fraud terjaring x recovery_rate (asumsi proporsi yang berhasil dipulihkan).',
      'Ini simulasi dari asumsi yang bisa diubah, bukan klaim penghematan.',
    ],
  };
}
