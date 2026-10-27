// KEBIJAKAN MINIMISASI DATA (policy-as-code). Satu-satunya tempat yang menentukan
// "layanan X boleh menerima field apa, dalam bentuk apa". Prinsipnya DEFAULT-DENY:
// field yang tidak tercantum di sini TIDAK PERNAH diteruskan ke layanan tujuan.
//
// op: pass      -> diteruskan apa adanya (data non-identitas)
//     tokenize  -> diganti pseudonim dinamis (per layanan + tujuan + epoch)
//     age_band  -> digeneralisasi jadi rentang umur
//     mask_tail -> hanya sisakan N karakter terakhir
//     vault     -> hanya disimpan di vault (untuk penyaring PII), tidak diteruskan ke layanan tujuan
export const POLICY = {
  version: '2026.10-demo',
  purposes: {
    // ttl_seconds: null -> pakai TOKEN_TTL_SECONDS (default 30 hari). reidentify_roles: siapa yang boleh membuka identitas.
    CLAIM_STORAGE: { tag: 'CLM', ttl_seconds: null, reidentify_roles: [] },
    RECORD_REF: { tag: 'REC', ttl_seconds: null, reidentify_roles: [] },
    CROSS_FACILITY_MATCHING: { tag: 'FRD', ttl_seconds: null, reidentify_roles: ['auditor'] },
    NAME_SCREEN: { tag: 'NSC', ttl_seconds: null, reidentify_roles: [] }, // hanya untuk penyaring PII (POST /v1/screen)
    NOTIFICATION: { tag: 'NTF', ttl_seconds: 86400, reidentify_roles: [] },
  },
  services: {
    CLAIM_PROCESSING: {
      allowed_purposes: ['CLAIM_STORAGE', 'RECORD_REF'],
      fields: {
        claim_id: { op: 'pass' }, facility_id: { op: 'pass' },
        patient_token: { op: 'tokenize', source: 'patient_nik', purpose: 'CLAIM_STORAGE' },
        record_token: { op: 'tokenize', source: 'record_number', purpose: 'RECORD_REF' },
        age_band: { op: 'age_band', source: 'birth_date' },
        diagnosis_code: { op: 'pass' }, procedure_code: { op: 'pass' }, claim_type: { op: 'pass' },
        admit_date: { op: 'pass' }, length_of_stay: { op: 'pass' }, amount: { op: 'pass' },
      },
    },
    FRAUD_DETECTION: {
      allowed_purposes: ['CROSS_FACILITY_MATCHING', 'NAME_SCREEN'],
      fields: {
        claim_id: { op: 'pass' }, facility_id: { op: 'pass' },
        fraud_ref: { op: 'tokenize', source: 'patient_nik', purpose: 'CROSS_FACILITY_MATCHING' },
        name_screen: { op: 'vault', source: 'patient_name', purpose: 'NAME_SCREEN' },
        diagnosis_code: { op: 'pass' }, procedure_code: { op: 'pass' }, claim_type: { op: 'pass' },
        admit_date: { op: 'pass' }, length_of_stay: { op: 'pass' }, amount: { op: 'pass' },
      },
    },
    NOTIFICATION: {
      allowed_purposes: ['NOTIFICATION'],
      fields: {
        claim_id: { op: 'pass' }, facility_id: { op: 'pass' },
        patient_hint: { op: 'mask_tail', source: 'patient_nik', keep: 4 },
      },
    },
  },
};

export function validatePolicy(policy) {
  for (const [svc, cfg] of Object.entries(policy.services)) {
    for (const p of cfg.allowed_purposes) {
      if (!policy.purposes[p]) throw new Error(`Policy: purpose ${p} (layanan ${svc}) tidak terdefinisi`);
    }
    for (const [field, rule] of Object.entries(cfg.fields)) {
      if (!['pass', 'tokenize', 'vault', 'age_band', 'mask_tail'].includes(rule.op)) throw new Error(`Policy: op tidak dikenal di ${svc}.${field}`);
      if ((rule.op === 'tokenize' || rule.op === 'vault') && !cfg.allowed_purposes.includes(rule.purpose)) throw new Error(`Policy: ${svc}.${field} memakai purpose ${rule.purpose} yang tidak diizinkan`);
    }
  }
  return policy;
}
