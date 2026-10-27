// T2: audit berantai hash, kuota harian, revoke -> ditolak di analitik, rotasi epoch, penyaring PII.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../shared/store.js';
import { createPrivacyCore } from '../services/privacy/core.js';
import { POLICY } from '../services/privacy/policy.js';
import { verifyChain } from '../services/privacy/chain.js';

const NIK = '9999123412341234';
const RECORD = { claim_id: 'C1', facility_id: 'RS-A', patient_nik: NIK, patient_name: 'Siti Rahayu', record_number: 'RM-A-1', birth_date: '1990-01-01', diagnosis_code: 'J18.9', admit_date: '2026-10-01', length_of_stay: 3, amount: 5000000 };
const auditor = { id: 'aud1', role: 'auditor' };

async function setup({ perDay = 20 } = {}) {
  const st = await createStore({ driver: 'memory', namespace: 'p' });
  const mappings = await st.collection('m'); const audit = await st.collection('a'); const meta = await st.collection('meta');
  const clock = { now: Date.parse('2026-10-27T00:00:00Z') };
  const core = createPrivacyCore({ mappings, audit, meta, policy: POLICY, config: { secrets: { HMAC_MASTER_KEY: 'k'.repeat(40) }, tokenTtlSeconds: 30 * 86400, reidentifyMaxPerHour: 100, reidentifyMaxPerDay: perDay }, clock: () => clock.now });
  return { core, audit, mappings, clock };
}
const args = (pseudonym, extra = {}) => ({ pseudonym, requesting_service: 'FRAUD_DETECTION', purpose: 'CROSS_FACILITY_MATCHING', actor: auditor, case_id: 'CASE-1', justification: 'Verifikasi dokumen klaim lintas faskes', ...extra });
const tokenOf = async (core, rec = RECORD) => (await core.minimize({ service: 'FRAUD_DETECTION', record: rec })).projection.fraud_ref;

test('rantai hash audit valid, dan perubahan/penghapusan terdeteksi', async () => {
  const { core, audit } = await setup();
  const tok = await tokenOf(core);
  await core.reidentify(args(tok));
  await core.recordEvent({ action: 'CASE_STATUS', actor: 'v1', role: 'verifier', target: 'CASE-1', reason: 'BARU -> DITINJAU' });
  await core.revokeSubject({ subject_id: NIK, actor: { id: 'adm' } });
  assert.deepEqual(await core.verifyAudit(), { valid: true, entries: 3 });
  const rows = (await audit.find({}, { orderBy: 'seq', dir: 'asc' })).filter((r) => r.hash);
  assert.equal(rows[1].hash_prev, rows[0].hash);
  // ubah isi satu entri
  await audit.update(rows[1].id, { actor: 'orang-lain' });
  const bad = verifyChain(await audit.find({}, { orderBy: 'seq', dir: 'asc' }));
  assert.equal(bad.valid, false); assert.equal(bad.broken_at, rows[1].seq);
  // hapus entri tengah
  await audit.update(rows[1].id, { actor: 'v1' });
  await audit.delete(rows[1].id);
  assert.equal(verifyChain(await audit.find({}, { orderBy: 'seq', dir: 'asc' })).valid, false);
});

test('reveal: verifikator ditolak, alasan pendek ditolak, kuota harian berlaku', async () => {
  const { core } = await setup({ perDay: 2 });
  const tok = await tokenOf(core);
  await assert.rejects(() => core.reidentify(args(tok, { actor: { id: 'v1', role: 'verifier' } })), (e) => e.status === 403);
  await core.reidentify(args(tok)); await core.reidentify(args(tok));
  await assert.rejects(() => core.reidentify(args(tok)), (e) => e.status === 429);
});

test('token tercabut tidak diproses lagi di analitik, dan revoke bisa lewat token', async () => {
  const { core } = await setup();
  const tok = await tokenOf(core);
  assert.ok((await core.revokeSubject({ pseudonym: tok, actor: { id: 'adm' } })).revoked >= 1);
  await assert.rejects(() => tokenOf(core), (e) => e.status === 403 && e.code === 'SUBJECT_REVOKED');
});

test('rotasi epoch mengubah token baru, token lama tidak dicocokkan dengan yang baru', async () => {
  const { core } = await setup();
  const t1 = await tokenOf(core);
  assert.equal(await tokenOf(core), t1);
  const r = await core.rotateKeys({ actor: { id: 'adm' } });
  assert.equal(r.rotation, 1);
  assert.notEqual(await tokenOf(core), t1);
});

test('penyaring PII: NIK 16 digit dan nama dari vault terdeteksi, token aman', async () => {
  const { core } = await setup();
  const tok = await tokenOf(core);
  assert.deepEqual((await core.screenText(`Pasien ${tok} dirawat 3 hari`)).hits, []);
  assert.ok((await core.screenText(`NIK 9999000011112222 dirawat`)).hits.includes('nik'));
  assert.ok((await core.screenText('Kasus melibatkan Siti Rahayu di dua RS')).hits.includes('vault'));
  assert.ok((await core.screenText('Kasus melibatkan siti rahayu')).hits.includes('vault'));
});
