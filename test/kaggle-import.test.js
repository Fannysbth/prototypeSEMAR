// Impor Kaggle -> skema SAMAR: pemetaan kolom (3 baris buatan) dan zone-leak BeneID.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapKaggle } from '../scripts/import-kaggle/map.js';

const bene = [{ BeneID: 'BENE1', DOB: '1943-01-01', Gender: '2', State: '39', County: '230' }];
const inpatient = [{
  BeneID: 'BENE1', ClaimID: 'CLM1', ClaimStartDt: '2009-04-12', ClaimEndDt: '2009-04-18', Provider: 'PRV1', InscClaimAmtReimbursed: '26000',
  AttendingPhysician: 'PHY1', AdmissionDt: '2009-04-10', DischargeDt: '2009-04-18', DiagnosisGroupCode: '201',
  ClmDiagnosisCode_1: '1970', ClmDiagnosisCode_2: '4019', ClmDiagnosisCode_3: 'NA', ClmProcedureCode_1: '4019', ClmProcedureCode_2: '3722', ClmProcedureCode_3: 'NA',
}];
const outpatient = [
  { BeneID: 'BENE1', ClaimID: 'CLM2', ClaimStartDt: '2009-05-01', ClaimEndDt: '2009-05-01', Provider: 'PRV2', InscClaimAmtReimbursed: '80', AttendingPhysician: 'PHY2', ClmDiagnosisCode_1: '78943', ClmDiagnosisCode_2: 'V5866' },
  { BeneID: 'BENE1', ClaimID: 'CLM3', ClaimStartDt: '2009-05-02', ClaimEndDt: '2009-05-03', Provider: 'PRV2', InscClaimAmtReimbursed: '30', AttendingPhysician: 'NA', ClmDiagnosisCode_1: '6115' },
];

test('pemetaan kolom Kaggle -> fkrtl/peserta/diag_sekunder SAMAR', () => {
  const { fkrtl, peserta, diagSekunder } = mapKaggle({ bene, inpatient, outpatient });
  const [ri, rj1, rj2] = fkrtl;
  assert.deepEqual([ri.FKL02, ri.PSTV01, ri.faskes_id, ri.jenis_layanan], ['CLM1', 'BENE1', 'PRV1', 'RI']);
  assert.deepEqual([ri.tgl_masuk, ri.tgl_pulang], ['2009-04-10', '2009-04-18']);
  assert.deepEqual([ri.diag_utama, ri.prosedur, ri.inacbg, ri.FKL47, ri.FKL48], ['1970', '4019|3722', '201', '26000', '']);
  assert.equal(ri.attending_physician, 'PHY1');
  assert.deepEqual([rj1.jenis_layanan, rj1.tgl_masuk, rj1.tgl_pulang, rj1.inacbg, rj1.prosedur], ['RJ', '2009-05-01', '2009-05-01', '', '']);
  assert.equal(rj2.attending_physician, '');
  assert.deepEqual(diagSekunder, [{ id_kunjungan: 'CLM1', kode_icd10: '4019' }, { id_kunjungan: 'CLM2', kode_icd10: 'V5866' }]);
  // Gender/DOB hanya di peserta.csv
  assert.deepEqual(peserta, [{ PSTV01: 'BENE1', PSTV02: '', nik: '', nama: '', tgl_lahir: '1943-01-01', jenis_kelamin: 'P', kab_kota: '39-230', segmen: '', PSTV15: '' }]);
  for (const r of fkrtl) assert.ok(!('tgl_lahir' in r) && !('jenis_kelamin' in r));
});

// --- Zone-leak: BeneID mentah tidak boleh sampai ke zona token (claims, fraud, notify) ---
import { startStack } from '../scripts/stack.js';
import { scanForPii } from '../shared/pii.js';
import { toCsv } from '../shared/csv.js';

const COLS = ['FKL02', 'PSTV01', 'faskes_id', 'jenis_faskes', 'kab_kota_faskes', 'tgl_masuk', 'tgl_pulang', 'jenis_layanan', 'diag_utama', 'prosedur', 'inacbg', 'kelas_rawat', 'FKL47', 'FKL48', 'faskes_perujuk', 'attending_physician'];
const KEY = 'kgl-internal-key-'.padEnd(40, 'x');

test('unggah fkrtl.csv Kaggle: BeneID ditokenisasi, tidak ada BeneID mentah di zona token', { timeout: 120000 }, async () => {
  const stack = await startStack({ quiet: true, env: {
    STORE: 'memory', ML_ENABLED: 'false', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test',
    JWT_SECRET: 'kgl-jwt-secret'.padEnd(40, 'j'), HMAC_MASTER_KEY: 'kgl-master-key'.padEnd(40, 'm'), INTERNAL_API_KEY: KEY,
    PORT: '5490', AUTH_PORT: '5491', PRIVACY_PORT: '5492', CLAIMS_PORT: '5493', FRAUD_PORT: '5494', NOTIFY_PORT: '5495',
    RATE_LIMIT_PER_MIN: '100000', LOGIN_MAX_FAILS_PER_MIN: '50', REIDENTIFY_MAX_PER_HOUR: '6',
    AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', TOKEN_TTL_SECONDS: '2592000', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '', LOG_LEVEL: 'error',
  } });
  try {
    const call = async (path, opts = {}) => { const r = await fetch(stack.baseUrl + path, opts); return { status: r.status, json: await r.json().catch(() => null) }; };
    const { json: { token } } = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'verifikator', password: 'demo-verifikator' }) });
    const auth = { authorization: `Bearer ${token}` };
    await call('/api/demo/tap', { method: 'DELETE', headers: auth });
    const { fkrtl } = mapKaggle({ bene, inpatient, outpatient });
    const extra = { ...fkrtl[2], FKL02: 'CLM4', PSTV01: 'BENE22222', FKL47: '0' }; // nilai 0 harus ditolak, bukan dipaksa
    const r = await call('/api/claims/upload?source=kaggle', { method: 'POST', headers: { ...auth, 'content-type': 'text/csv' }, body: toCsv([...fkrtl, extra], COLS) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.total, r.json.accepted, r.json.rejected], [4, 3, 1], JSON.stringify(r.json.errors));
    for (const svc of ['claims', 'fraud', 'notify']) {
      const tap = (await call(`/api/demo/tap/${svc}`, { headers: auth })).json.items;
      if (svc !== 'notify') assert.ok(tap.length > 0, svc); // notify hanya menerima kasus; 3 klaim tidak membuat kasus
      assert.deepEqual(scanForPii(tap.map((t) => t.body), new Map([['BENE1', 'PSTV01']])), [], `BeneID bocor ke ${svc}`);
      assert.ok(!JSON.stringify(tap).includes('BENE1'), `BeneID mentah di ${svc}`);
    }
  } finally { await stack.stop(); }
});
