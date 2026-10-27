// UNGGAH CSV BATCH: validasi per baris memakai skema klaim yang sama dengan POST /api/claims, lalu lewat pipeline
// (privacy -> claims -> fraud). Baris gagal tidak menghentikan batch; dilaporkan dengan nomor baris (header = baris 1).
// Header boleh memakai nama prototype atau kode kamus BPJS (config/column-map.json). Status batch disimpan di store (tahan restart).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/config.js';
import { parseCsv } from '../../shared/csv.js';
import { FACILITIES } from '../../shared/reference.js';
import { HttpError } from '../../shared/http.js';

const MAX_ROWS = 20000;
const MAX_ERRORS = 100;
const CONCURRENCY = 16;
const optional = new Set(['phone', 'procedure_code']);
const columnMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'column-map.json'), 'utf8'));
const bpjsToInternal = Object.fromEntries(Object.entries(columnMap.prototype_to_bpjs).map(([internal, code]) => [code, internal]));
const ignored = new Set(columnMap.diabaikan_saat_unggah);
const NON_CLAIM = new Set(['facility_id', 'claim_ref', ...ignored]);
const CLAIM_REF = /^[A-Za-z0-9_-]{3,64}$/;

const normalizeRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [bpjsToInternal[k] ?? k, v]));

export function rowToClaim(row) {
  const claim = {};
  for (const [k, v] of Object.entries(row)) {
    if (NON_CLAIM.has(k)) continue;
    const s = v.trim();
    if (s === '' && optional.has(k)) continue;
    claim[k] = k === 'length_of_stay' || k === 'amount' ? (s === '' ? undefined : Number(s)) : s;
  }
  return claim;
}

export function createUploader({ claimSchema, pipeline, batches, mode }) {
  const knownFacility = new Set(FACILITIES.map((f) => f.id));

  async function upload({ csv, user, requestId }) {
    const rows = parseCsv(csv).map(normalizeRow);
    if (rows.length === 0) throw new HttpError(400, 'EMPTY_CSV', 'CSV kosong atau tanpa baris data');
    if (rows.length > MAX_ROWS) throw new HttpError(413, 'TOO_MANY_ROWS', `Maksimal ${MAX_ROWS} baris per unggahan`);
    const batch = { batch_id: `BTH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, uploaded_by: user.sub, total: rows.length, accepted: 0, rejected: 0, errors: [], cases: 0, created_ms: Date.now() };
    const fail = (row, message) => { batch.rejected += 1; if (batch.errors.length < MAX_ERRORS) batch.errors.push({ row, message }); };

    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const i = next; next += 1;
        const rowNo = i + 2;
        const raw = rows[i];
        const facility_id = user.facility_id ?? raw.facility_id?.trim();
        if (!knownFacility.has(facility_id)) { fail(rowNo, 'facility_id tidak dikenal'); continue; }
        if (user.facility_id && raw.facility_id?.trim() && raw.facility_id.trim() !== user.facility_id) { fail(rowNo, 'facility_id tidak sesuai akun'); continue; }
        const ref = raw.claim_ref?.trim();
        if (ref && !CLAIM_REF.test(ref)) { fail(rowNo, 'claim_ref (FKL02) tidak valid'); continue; }
        const parsed = claimSchema.safeParse(rowToClaim(raw));
        if (!parsed.success) { fail(rowNo, parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')); continue; }
        try {
          const r = await pipeline.submitClaim({ claim: parsed.data, facility_id, mode, actor: user, requestId, claimId: ref || undefined });
          batch.accepted += 1;
          if (r.fraud.case_id) batch.cases += 1;
        } catch (err) { fail(rowNo, err.code ?? 'gagal diproses'); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    batch.errors.sort((a, b) => a.row - b.row);
    await batches.put(batch.batch_id, batch);
    return batch;
  }

  return { upload, get: async (id) => (await batches.get(id)) ?? null };
}
