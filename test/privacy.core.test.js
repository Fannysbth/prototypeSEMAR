import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../shared/store.js';
import { createPrivacyCore } from '../services/privacy/core.js';
import { POLICY } from '../services/privacy/policy.js';

const DAY = 86400000;
const NIK = '9999123412341234';
const RECORD = { claim_id: 'CLM-1', facility_id: 'RS-A', patient_nik: NIK, patient_name: 'Budi Santoso', phone: '081234567890', birth_date: '1985-04-12', record_number: 'RM-A-000123', diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', admit_date: '2026-09-20', length_of_stay: 4, amount: 6200000 };

async function setup({ key = 'k'.repeat(64), now = Date.UTC(2026, 9, 1), maxReid = 3 } = {}) {
  const store = await createStore({ driver: 'memory', namespace: 'p' });
  const mappings = await store.collection('mappings');
  const audit = await store.collection('audit');
  const clock = { now };
  const core = createPrivacyCore({ mappings, audit, policy: POLICY, config: { secrets: { HMAC_MASTER_KEY: key }, tokenTtlSeconds: 30 * 86400, reidentifyMaxPerHour: maxReid }, clock: () => clock.now });
  return { core, mappings, audit, clock };
}
const verifier = { id: 'v1', role: 'auditor' }; // reveal hanya auditor (spesifikasi PRD)
const fraudArgs = (pseudonym, extra = {}) => ({ pseudonym, requesting_service: 'FRAUD_DETECTION', purpose: 'CROSS_FACILITY_MATCHING', actor: verifier, case_id: 'CASE-1', justification: 'Investigasi indikasi klaim berulang lintas faskes', ...extra });

test('token deterministik untuk subjek+layanan+tujuan+epoch yang sama (kunci pencocokan lintas-faskes)', async () => {
  const { core } = await setup();
  const a = await core.minimize({ service: 'FRAUD_DETECTION', record: { ...RECORD, facility_id: 'RS-A' } });
  const b = await core.minimize({ service: 'FRAUD_DETECTION', record: { ...RECORD, facility_id: 'RS-B', claim_id: 'CLM-2' } });
  assert.equal(a.projection.fraud_ref, b.projection.fraud_ref);
  assert.match(a.projection.fraud_ref, /^PSE_FRD_[0-9A-F]{20}$/);
});

test('token BERBEDA antar layanan/tujuan dan antar subjek (least-privilege)', async () => {
  const { core } = await setup();
  const f = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  const c = (await core.minimize({ service: 'CLAIM_PROCESSING', record: RECORD })).projection.patient_token;
  const other = (await core.minimize({ service: 'FRAUD_DETECTION', record: { ...RECORD, patient_nik: '9999000011112222' } })).projection.fraud_ref;
  assert.notEqual(f, c);
  assert.notEqual(f, other);
});

test('token bergantung pada master key rahasia', async () => {
  const a = await setup({ key: 'a'.repeat(64) });
  const b = await setup({ key: 'b'.repeat(64) });
  assert.notEqual((await a.core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref, (await b.core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref);
});

test('kebijakan default-deny: proyeksi tidak memuat PII langsung', async () => {
  const { core } = await setup();
  const claims = (await core.minimize({ service: 'CLAIM_PROCESSING', record: RECORD })).projection;
  const fraud = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection;
  const notif = (await core.minimize({ service: 'NOTIFICATION', record: RECORD })).projection;
  for (const proj of [claims, fraud, notif]) {
    const blob = JSON.stringify(proj);
    for (const v of [NIK, 'Budi Santoso', '081234567890', '1985-04-12', 'RM-A-000123']) assert.ok(!blob.includes(v), `bocor: ${v}`);
  }
  assert.equal(claims.age_band, '40-59');
  assert.equal(notif.patient_hint, '************1234');
  assert.equal(Object.keys(fraud).includes('patient_name'), false);
});

test('rotasi epoch: token berubah & token lama kedaluwarsa', async () => {
  const { core, clock } = await setup();
  const t1 = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  clock.now += 31 * DAY;
  const t2 = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  assert.notEqual(t1, t2);
  await assert.rejects(() => core.reidentify(fraudArgs(t1)), (e) => e.status === 403);
});

test('re-identifikasi: sukses hanya untuk peran, layanan, tujuan yang tepat', async () => {
  const { core } = await setup({ maxReid: 50 });
  const tok = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  assert.equal((await core.reidentify(fraudArgs(tok))).subject_id, NIK);
  const bad = [
    fraudArgs(tok, { actor: { id: 'f1', role: 'facility' } }),
    fraudArgs(tok, { requesting_service: 'CLAIM_PROCESSING' }),
    fraudArgs(tok, { purpose: 'CLAIM_STORAGE' }),
    fraudArgs('PSE_FRD_00000000000000000000'),
  ];
  for (const b of bad) await assert.rejects(() => core.reidentify(b), (e) => e.status === 403 && e.code === 'REIDENTIFY_DENIED');
});

test('token layanan lain tidak bisa dibuka lewat tujuan fraud (lintas-layanan ditolak)', async () => {
  const { core } = await setup();
  const claimTok = (await core.minimize({ service: 'CLAIM_PROCESSING', record: RECORD })).projection.patient_token;
  await assert.rejects(() => core.reidentify(fraudArgs(claimTok)), (e) => e.status === 403);
  await assert.rejects(() => core.reidentify({ ...fraudArgs(claimTok), requesting_service: 'CLAIM_PROCESSING', purpose: 'CLAIM_STORAGE' }), (e) => e.status === 403);
});

test('kuota re-identifikasi per jam mencegah pembukaan massal oleh orang dalam', async () => {
  const { core } = await setup({ maxReid: 3 });
  const tok = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  for (let i = 0; i < 3; i += 1) await core.reidentify(fraudArgs(tok));
  await assert.rejects(() => core.reidentify(fraudArgs(tok)), (e) => e.status === 429);
});

test('audit log tidak pernah memuat NIK mentah; vault tidak menyimpan NIK sebagai teks biasa', async () => {
  const { core, audit, mappings } = await setup({ maxReid: 50 });
  const tok = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  await core.reidentify(fraudArgs(tok));
  await assert.rejects(() => core.reidentify(fraudArgs(tok, { actor: { id: 'x', role: 'facility' } })));
  const log = JSON.stringify(await audit.find({}));
  assert.ok(!log.includes(NIK));
  assert.ok(log.includes('"status":"SUCCESS"') && log.includes('"status":"DENIED"'));
  assert.ok(!JSON.stringify(await mappings.find({})).includes(NIK));
});

test('vault dilindungi AES-GCM: data yang dimanipulasi tidak bisa didekripsi', async () => {
  const { core, mappings } = await setup({ maxReid: 50 });
  const tok = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  const m = await mappings.get(tok);
  const parts = m.subject_enc.split('.');
  parts[3] = Buffer.from('tampered-bytes').toString('base64');
  await mappings.update(tok, { subject_enc: parts.join('.') });
  await assert.rejects(() => core.reidentify(fraudArgs(tok)));
});

test('revoke (hak subjek UU PDP): identitas tak bisa dibuka lagi, vault dihapus', async () => {
  const { core, mappings } = await setup({ maxReid: 50 });
  const tok = (await core.minimize({ service: 'FRAUD_DETECTION', record: RECORD })).projection.fraud_ref;
  assert.ok((await core.revokeSubject({ subject_id: NIK, actor: verifier })).revoked >= 1);
  assert.equal((await mappings.get(tok)).subject_enc, null);
  await assert.rejects(() => core.reidentify(fraudArgs(tok)), (e) => e.status === 403);
});

test('layanan tujuan tak dikenal ditolak', async () => {
  const { core } = await setup();
  await assert.rejects(() => core.minimize({ service: 'HACKER', record: RECORD }), (e) => e.status === 400);
});
