import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'tanggal tidak valid');

export function buildClaimSchema({ syntheticOnly }) {
  return z.object({
    patient_nik: z.string().regex(/^\d{16}$/, 'NIK harus 16 digit angka').refine(
      (v) => !syntheticOnly || v.startsWith('9999'),
      'Mode ini hanya menerima NIK SINTETIS berawalan 9999. Dilarang memakai data peserta JKN riil.',
    ),
    patient_name: z.string().trim().min(2).max(100),
    phone: z.string().regex(/^(\+62|0)8\d{7,12}$/, 'format telepon tidak valid').optional(),
    birth_date: isoDate,
    record_number: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9\-_./]+$/, 'karakter no. rekam medis tidak valid'),
    diagnosis_code: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'format ICD-10, contoh J18.9'),
    procedure_code: z.string().regex(/^\d{2}(\.\d{1,2})?$/, 'format ICD-9-CM, contoh 96.71').optional(),
    claim_type: z.enum(['RI', 'RJ']).default('RI'),
    admit_date: isoDate.refine((s) => {
      const t = Date.parse(`${s}T00:00:00Z`);
      return t >= Date.parse('2020-01-01T00:00:00Z') && t <= Date.now() + 30 * 86400000;
    }, 'tanggal di luar rentang yang wajar'),
    length_of_stay: z.number().int().min(1).max(365),
    amount: z.number().positive().max(5_000_000_000),
  }).strict(); // field tak dikenal ditolak (cegah mass-assignment)
}

export const loginSchema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });
export const reviewSchema = z.object({
  decision: z.enum(['CONFIRMED_FRAUD', 'DISMISSED_FALSE_POSITIVE', 'NEEDS_MORE_INFO']),
  note: z.string().trim().min(3).max(500),
}).strict();
export const revealSchema = z.object({ justification: z.string().trim().min(20, 'alasan minimal 20 karakter').max(500) }).strict();
export const revokeSchema = z.object({ patient_nik: z.string().regex(/^\d{16}$/) }).strict();
