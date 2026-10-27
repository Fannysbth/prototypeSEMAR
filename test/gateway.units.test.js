// T2: penjelasan LLM (penyaring PII, fallback), simulasi dampak, zip, unggah CSV tahan restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../shared/store.js';
import { createPrivacyCore } from '../services/privacy/core.js';
import { POLICY } from '../services/privacy/policy.js';
import { createExplainer, casePayload } from '../services/gateway/explain.js';
import { simulateImpact, impactSchema } from '../services/gateway/impact.js';
import { createUploader } from '../services/gateway/upload.js';
import { buildClaimSchema } from '../services/gateway/schemas.js';
import { zipFiles } from '../shared/zip.js';

const CASE = { claim_id: 'FKL-1', fraud_ref: 'PSE_FRD_ABCDEF0123456789ABCD', diagnosis_code: 'J18.9', amount: 18000000, admit_date: '2026-10-01', risk_score: 82, risk_level: 'HIGH', facilities: ['RS-A', 'RS-B'], modi: ['UPCODING'], features: { n_faskes_30d: 2 }, flags: [{ reason: 'Nominal Rp18.000.000 adalah 2.9x median referensi diagnosis J18.9.' }] };
const llm = { provider: 'anthropic', model: 'm', apiKey: 'k', baseUrl: 'http://llm.test', timeoutMs: 50 };
const clean = async () => ({ hits: [] });
const okFetch = (calls) => async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, json: async () => ({ content: [{ text: 'Ada indikasi nominal tinggi.' }] }) }; };

test('LLM: key kosong -> templat; payload ke LLM hanya token/ICD/angka/alasan', async () => {
  const calls = [];
  assert.equal((await createExplainer({ llm: { ...llm, apiKey: '' }, screen: clean, fetchImpl: okFetch(calls) }).explain(CASE)).source, 'template');
  assert.equal(calls.length, 0);
  const r = await createExplainer({ llm, screen: clean, fetchImpl: okFetch(calls) }).explain(CASE);
  assert.equal(r.source, 'llm'); assert.equal(calls.length, 1);
  assert.ok(calls[0].body.includes('PSE_FRD_') && calls[0].body.includes('J18.9'));
  assert.deepEqual(Object.keys(casePayload(CASE)).filter((k) => /nama|nik|lahir|alamat|telepon/.test(k)), []);
});

test('LLM: penyaring PII menolak panggilan bila ada NIK atau nama dari vault', async () => {
  const st = await createStore({ driver: 'memory', namespace: 'x' });
  const core = createPrivacyCore({ mappings: await st.collection('m'), audit: await st.collection('a'), policy: POLICY, config: { secrets: { HMAC_MASTER_KEY: 'k'.repeat(40) }, tokenTtlSeconds: 2592000, reidentifyMaxPerHour: 9 } });
  await core.minimize({ service: 'FRAUD_DETECTION', record: { claim_id: 'C', facility_id: 'RS-A', patient_nik: '9999123412341234', patient_name: 'Siti Rahayu', diagnosis_code: 'J18.9' } });
  const calls = [];
  const ex = createExplainer({ llm, screen: (t) => core.screenText(t), fetchImpl: okFetch(calls) });
  for (const leak of ['NIK 9999123412341234 terlibat', 'Pasien Siti Rahayu dirawat']) {
    const r = await ex.explain({ ...CASE, flags: [{ reason: leak }] });
    assert.equal(r.source, 'template'); assert.match(r.note, /PII terdeteksi/);
  }
  assert.equal(calls.length, 0, 'LLM tidak boleh dipanggil');
});

test('LLM: timeout atau galat -> templat', async () => {
  const slow = async (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
  assert.equal((await createExplainer({ llm, screen: clean, fetchImpl: slow }).explain(CASE)).source, 'template');
  assert.equal((await createExplainer({ llm, screen: clean, fetchImpl: async () => ({ ok: false, status: 500 }) }).explain(CASE)).source, 'template');
});

test('simulasi dampak: hitungan benar, asumsi ikut dikembalikan, parameter divalidasi', () => {
  const r = simulateImpact(impactSchema.parse({ annual_claim_value: 1e12, fraud_rate: 0.03, review_capacity: 0.01, precision_at_k: 0.5, recovery_rate: 0.6, biaya_operasional: 1e9 }));
  assert.equal(r.result.potensi_nilai_dipertanyakan_rp, 3e10); assert.equal(r.result.nilai_terdeteksi_rp, 5e9);
  assert.equal(r.result.potensi_pemulihan_rp, 3e9); assert.equal(r.result.potensi_penghematan_bersih_rp, 2e9);
  assert.ok(r.assumptions.length >= 4);
  assert.throws(() => impactSchema.parse({ annual_claim_value: 1, fraud_rate: 2, review_capacity: 0, precision_at_k: 0, recovery_rate: 0 }));
});

test('zip: signature dan jumlah entri benar', () => {
  const z = zipFiles({ 'a.csv': 'x,y\n1,2\n', 'b.csv': 'z\n' });
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 2);
});

test('status batch unggahan tahan restart (disimpan di store, bukan memori proses)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'samar-batch-'));
  const open = async () => (await createStore({ driver: 'file', namespace: 'gateway', dataDir: dir })).collection('batches');
  const batches = await open();
  const pipeline = { submitClaim: async () => ({ fraud: { case_id: null } }) };
  const schema = buildClaimSchema({ syntheticOnly: true });
  const up = createUploader({ claimSchema: schema, pipeline, batches, mode: 'proposed' });
  const csv = 'FKL02,facility_id,PSTV01,patient_name,birth_date,record_number,diagnosis_code,admit_date,length_of_stay,FKL47\nFKL-9,RS-A,9999000011112222,Budi Santoso,1980-01-02,RM-1,J18.9,2026-09-10,4,6200000\n';
  const b = await up.upload({ csv, user: { sub: 'v1' } });
  assert.equal(b.accepted, 1, JSON.stringify(b.errors));
  await new Promise((r) => setTimeout(r, 400));
  const again = createUploader({ claimSchema: schema, pipeline, batches: await open(), mode: 'proposed' });
  assert.equal((await again.get(b.batch_id)).accepted, 1);
});
