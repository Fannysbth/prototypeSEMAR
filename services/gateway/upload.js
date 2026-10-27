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

const maskNik = (v) => { const n = String(v ?? '').trim(); return n.length >= 6 ? `${n.slice(0, 4)}${'*'.repeat(Math.max(4, n.length - 6))}${n.slice(-2)}` : '-'; };
const previewRow = (raw, i) => ({ row: i + 2, claim_ref: raw.claim_ref?.trim() || '-', facility_id: raw.facility_id?.trim() || '-', patient_hint: maskNik(raw.patient_nik), admit_date: raw.admit_date?.trim() || '-', diagnosis_code: raw.diagnosis_code?.trim() || '-', amount: Number(raw.amount) || 0 });

// Faskes hanya melihat Validasi, Tokenisasi, Selesai (tanpa skor, kasus, atau sinyal: mencegah "tipping off").
// Verifikator, auditor, dan admin melihat pipeline lengkap dengan angka tiap tahap.
export function viewBatch(b, role) {
  const done = b.status === 'SELESAI';
  const common = { batch_id: b.batch_id, status: b.status, total: b.total, accepted: b.accepted, rejected: b.rejected, errors: b.errors, preview: b.preview, created_ms: b.created_ms };
  if (role === 'facility') {
    return { ...common, stages: [
      { id: 'validasi', label: 'Validasi', count: b.validated, detail: 'baris lolos pemeriksaan format' },
      { id: 'tokenisasi', label: 'Tokenisasi', count: b.tokenized, detail: 'identitas diganti token' },
      { id: 'selesai', label: 'Selesai', count: done ? b.accepted : 0, detail: 'klaim diterima' },
    ] };
  }
  return { ...common, cases: b.cases, analyzed: b.analyzed, flagged: b.flagged, cross_facility: b.cross_facility, stages: [
    { id: 'validasi', label: 'Validasi', count: b.validated, detail: 'baris lolos pemeriksaan format' },
    { id: 'tokenisasi', label: 'Tokenisasi', count: b.tokenized, detail: 'identitas diganti token' },
    { id: 'fitur_lintas_faskes', label: 'Fitur lintas faskes', count: b.cross_facility, detail: 'klaim dengan riwayat token di lebih dari satu faskes' },
    { id: 'deteksi', label: 'Deteksi', count: b.flagged, detail: 'klaim dengan minimal satu sinyal' },
    { id: 'kasus', label: 'Kasus', count: b.cases, detail: 'kasus berisiko dibuat' },
  ] };
}

export function createUploader({ claimSchema, pipeline, batches, mode }) {
  const knownFacility = new Set(FACILITIES.map((f) => f.id));
  const live = new Map(); // batch yang sedang diproses (polling membaca dari sini)

  async function process(batch, rows, user, requestId) {
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
        batch.validated += 1;
        const onStage = (stage, info = {}) => {
          if (stage === 'tokenized') batch.tokenized += 1;
          if (stage === 'analyzed') { batch.analyzed += 1; if (info.cross_facility) batch.cross_facility += 1; if (info.flagged) batch.flagged += 1; if (info.case_id) batch.cases += 1; }
        };
        try {
          await pipeline.submitClaim({ claim: parsed.data, facility_id, mode, actor: user, requestId, claimId: ref || undefined, onStage });
          batch.accepted += 1;
        } catch (err) { fail(rowNo, err.code ?? 'gagal diproses'); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    batch.errors.sort((a, b) => a.row - b.row);
    batch.status = 'SELESAI';
    await batches.put(batch.batch_id, batch);
    live.delete(batch.batch_id);
  }

  async function upload({ csv, user, requestId, async = false }) {
    const rows = parseCsv(csv).map(normalizeRow);
    if (rows.length === 0) throw new HttpError(400, 'EMPTY_CSV', 'CSV kosong atau tanpa baris data');
    if (rows.length > MAX_ROWS) throw new HttpError(413, 'TOO_MANY_ROWS', `Maksimal ${MAX_ROWS} baris per unggahan`);
    const batch = {
      batch_id: `BTH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, uploaded_by: user.sub, status: 'DIPROSES', total: rows.length,
      validated: 0, tokenized: 0, analyzed: 0, cross_facility: 0, flagged: 0, cases: 0, accepted: 0, rejected: 0, errors: [],
      preview: rows.slice(0, 20).map(previewRow), created_ms: Date.now(),
    };
    live.set(batch.batch_id, batch);
    const run = process(batch, rows, user, requestId).catch(async (err) => { batch.status = 'GAGAL'; batch.errors.push({ row: 0, message: err.code ?? 'gagal diproses' }); live.delete(batch.batch_id); await batches.put(batch.batch_id, batch); });
    if (!async) await run;
    return batch;
  }

  const listBy = async (sub) => {
    const stored = await batches.find({ eq: { uploaded_by: sub } }, { orderBy: 'created_ms', dir: 'desc', limit: 50 });
    const running = [...live.values()].filter((b) => b.uploaded_by === sub);
    return [...running, ...stored.filter((b) => !live.has(b.batch_id))].sort((a, b) => b.created_ms - a.created_ms);
  };
  return { upload, listBy, get: async (id) => live.get(id) ?? (await batches.get(id)) ?? null };
}
