// PIPELINE KLAIM: satu-satunya tempat yang membedakan mode baseline vs proposed.
//   baseline : payload mentah dikirim apa adanya ke Claim & Fraud & Notification (arsitektur konvensional)
//   proposed : Privacy Service menerapkan kebijakan minimisasi per layanan dulu (SAMAR)
// Kode Claim/Fraud/Notification Service sama persis di kedua mode -> perbedaan kinerja/privasi murni akibat lapisan SAMAR.
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HttpError } from '../../shared/http.js';

export function createPipeline({ config, clients, logger }) {
  async function submitClaim({ claim, facility_id, mode, actor, idempotencyKey, requestId }) {
    const t0 = performance.now();
    const timings = {};
    const claim_id = idempotencyKey
      ? `CLM-${crypto.createHash('sha256').update(`${facility_id}|${idempotencyKey}`).digest('hex').slice(0, 12).toUpperCase()}`
      : `CLM-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const raw = { claim_id, facility_id, ...claim };
    const by = actor.sub;

    let claimPayload;
    let fraudPayload;
    if (mode === 'proposed') {
      const tp = performance.now();
      const [c, f] = await Promise.all([
        clients.privacy.minimize({ service: 'CLAIM_PROCESSING', record: raw, actor: by }, requestId),
        clients.privacy.minimize({ service: 'FRAUD_DETECTION', record: raw, actor: by }, requestId),
      ]);
      timings.privacy_ms = +(performance.now() - tp).toFixed(1);
      claimPayload = { ...c.projection };
      fraudPayload = { ...f.projection };
    } else {
      claimPayload = { ...raw };
      fraudPayload = { ...raw, fraud_ref: raw.patient_nik };
    }
    claimPayload.meta = { mode, submitted_by: by };

    const tc = performance.now();
    await clients.claims.create(claimPayload, requestId);
    timings.claims_ms = +(performance.now() - tc).toFixed(1);

    const tf = performance.now();
    const fraud = await clients.fraud.analyze(fraudPayload, requestId);
    timings.fraud_ms = +(performance.now() - tf).toFixed(1);

    if (fraud.case_id) {
      try {
        const modi = [...new Set(fraud.flags.map((x) => x.modus))];
        const note = mode === 'proposed'
          ? (await clients.privacy.minimize({ service: 'NOTIFICATION', record: raw, actor: by }, requestId)).projection
          : { claim_id, facility_id, patient_hint: raw.patient_nik, patient_name: raw.patient_name };
        await clients.notify.send({ ...note, case_id: fraud.case_id, risk_level: fraud.risk_level, modi }, requestId);
      } catch (err) {
        logger.warn('notifikasi gagal (klaim tetap tersimpan)', { code: err.code });
      }
    }

    timings.total_ms = +(performance.now() - t0).toFixed(1);
    return {
      claim_id, mode, facility_id,
      fraud: { risk_score: fraud.risk_score, risk_level: fraud.risk_level, ml_score: fraud.ml_score, flags: fraud.flags, case_id: fraud.case_id },
      timings,
      ...(config.demoMode ? { visibility: { claims_received: claimPayload, fraud_received: fraudPayload } } : {}),
    };
  }

  return { submitClaim };
}

export function ensureMode(config, requested) {
  if (requested === undefined || requested === '') return config.defaultMode;
  if (requested === 'proposed') return 'proposed';
  if (requested === 'baseline') {
    if (!config.allowBaseline) throw new HttpError(403, 'BASELINE_DISABLED', 'Mode baseline dinonaktifkan di environment ini');
    return 'baseline';
  }
  throw new HttpError(400, 'INVALID_MODE', 'mode harus baseline atau proposed');
}
