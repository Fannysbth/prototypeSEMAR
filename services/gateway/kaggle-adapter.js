// Adaptor unggahan fkrtl.csv hasil scripts/import-kaggle (dataset Kaggle, Medicare AS 2009) ke baris klaim internal.
// PSTV01 (BeneID) tidak pernah diteruskan mentah: diubah ke id 16 digit berawalan 9999 yang injektif agar masuk
// jalur tokenisasi privacy yang sama dengan NIK sintetis. Kode diagnosis ICD-9, nilai USD.
import { z } from 'zod';
import { buildClaimSchema } from './schemas.js';

const DAY = 86400000;
const pseudoId = (beneId) => { const d = String(beneId).match(/\d+$/)?.[0]; return d && d.length <= 12 ? `9999${d.padStart(12, '0')}` : ''; };
const icd9Procedure = (s) => (/^\d{3,4}$/.test(s) ? `${s.slice(0, 2)}.${s.slice(2)}` : s);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

// Rawat jalan satu hari = LOS 1 (skema internal minimal 1 hari).
export function kaggleRowToUpload(r) {
  const masuk = (r.tgl_masuk ?? '').trim(); const pulang = (r.tgl_pulang ?? '').trim();
  const los = days(masuk, pulang);
  return {
    claim_ref: r.FKL02, facility_id: r.faskes_id, patient_nik: pseudoId(r.PSTV01 ?? ''), patient_name: 'Kaggle Beneficiary', birth_date: '1900-01-01',
    record_number: r.FKL02, diagnosis_code: r.diag_utama, procedure_code: icd9Procedure((r.prosedur ?? '').split('|')[0]),
    claim_type: r.jenis_layanan, admit_date: masuk, length_of_stay: Number.isFinite(los) ? String(Math.max(1, los)) : '', amount: r.FKL47,
  };
}

export function buildKaggleClaimSchema({ syntheticOnly }) {
  return buildClaimSchema({ syntheticOnly }).extend({
    diagnosis_code: z.string().regex(/^[A-Z0-9]{3,7}$/, 'format ICD-9, contoh 4019 atau V5866'),
    admit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal YYYY-MM-DD'),
  });
}
