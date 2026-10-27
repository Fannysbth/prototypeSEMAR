// POST /verify: skor satu klaim secara sinkron. participant_id langsung ditokenisasi di gateway (lewat Privacy Service)
// dan tidak diteruskan ke layanan lain. Penjelasan memakai templat (cepat); LLM dipakai lewat POST /cases/{id}/explain.
import { z } from 'zod';
import { templateExplanation } from './explain.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'tanggal tidak valid');
const DAY = 86400000;

export function buildVerifySchema({ syntheticOnly }) {
  return z.object({
    claim_id: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/),
    level: z.enum(['FKTP', 'FKRTL', 'PNK']),
    participant_id: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/).refine((v) => !syntheticOnly || !/^\d{16}$/.test(v) || v.startsWith('9999'), 'NIK nyata dilarang; pakai id peserta sintetis'),
    facility_id: z.string().regex(/^[A-Za-z0-9_-]{2,20}$/),
    admit_date: isoDate,
    discharge_date: isoDate.optional(),
    diagnosis_primary: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'format ICD-10, contoh J18.9'),
    diagnosis_secondary: z.array(z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/)).max(20).optional(),
    procedures: z.array(z.string().regex(/^\d{2}(\.\d{1,2})?$/)).max(20).optional(),
    inacbg_code: z.string().max(20).optional(),
    billed_amount: z.number().positive().max(5_000_000_000),
  }).strict().refine((v) => !v.discharge_date || v.discharge_date >= v.admit_date, { message: 'discharge_date sebelum admit_date', path: ['discharge_date'] });
}

export function toPipelineClaim(v) {
  const los = v.discharge_date ? Math.max(1, Math.round((Date.parse(v.discharge_date) - Date.parse(v.admit_date)) / DAY)) : 1;
  return {
    patient_nik: v.participant_id, diagnosis_code: v.diagnosis_primary, ...(v.procedures?.length ? { procedure_code: v.procedures[0] } : {}),
    claim_type: los >= 2 ? 'RI' : 'RJ', admit_date: v.admit_date, length_of_stay: los, amount: v.billed_amount,
  };
}

export function toVerifyResponse(v, r, latencyMs) {
  const f = r.fraud;
  const explainable = { claim_id: v.claim_id, diagnosis_code: v.diagnosis_primary, amount: v.billed_amount, risk_score: f.risk_score, risk_level: f.risk_level, flags: f.flags, facilities: [] };
  return {
    claim_id: v.claim_id, subject_token: r.subject_token, score: f.risk_score, risk: f.risk_level, case_id: f.case_id,
    signals: f.flags.map((x) => ({ detector: x.rule, modus: x.modus, score: +(x.score / 100).toFixed(2), reason: x.reason })),
    explanation: f.flags.length ? templateExplanation(explainable) : 'Tidak ada indikasi yang melewati ambang deteksi.',
    explanation_source: 'template', ml_status: f.ml_status, model_version: f.model_version ?? f.engine_version, latency_ms: Math.round(latencyMs),
  };
}
