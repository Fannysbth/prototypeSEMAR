// Penjelasan LLM: penyaring PII, jalur fallback, dan daftar putih field yang dikirim (mock HTTP, tanpa panggilan nyata).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplainer, casePayload } from '../services/gateway/explain.js';
import { scanForPii } from '../shared/pii.js';

const CASE = {
  claim_id: 'CLM-1', fraud_ref: 'PSE_FRD_ABCDEF0123456789ABCD', facility_id: 'PRV1', diagnosis_code: '4019', procedure_code: '40.19', amount: 18000, admit_date: '2009-10-01',
  risk_score: 82, risk_level: 'HIGH', facilities: ['PRV1', 'PRV2'], modi: ['CROSS_FACILITY_HOPPING', 'ML_SUPERVISED'], features: { n_faskes_30d: 3 },
  flags: [
    { modus: 'CROSS_FACILITY_HOPPING', score: 70, reason: 'Token yang sama muncul di 3 faskes dalam 30 hari.' },
    { modus: 'ML_SUPERVISED', score: 64, reason: 'Risiko faskes tinggi.', evidence: { supervised_score: 0.64, top_features: [['faskes:billed_mean', 0.2]] } },
  ],
  // field yang tidak boleh ikut terkirim walau ada di objek kasus
  patient_name: 'Budi Santoso', patient_nik: '9999000011112222', phone: '081234567890', birth_date: '1943-01-01',
};
const llm = { provider: 'anthropic', model: 'm', apiKey: 'k', baseUrl: 'http://llm.test', timeoutMs: 1000 };
const screen = async (t) => ({ hits: scanForPii(t) });
const spy = (calls) => async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ content: [{ text: 'Klaim perlu diperiksa karena token muncul di beberapa faskes.' }] }) }; };

test('penyaring menolak payload ber-NIK atau BeneID mentah: LLM tidak dipanggil, ditandai untuk audit', async () => {
  for (const leak of ['9999000011112222', 'BENE11001']) {
    const calls = [];
    const r = await createExplainer({ llm, screen, fetchImpl: spy(calls) }).explain({ ...CASE, flags: [{ modus: 'X', score: 1, reason: `Pasien ${leak} berobat dua kali.` }] });
    assert.equal(r.source, 'template', leak);
    assert.equal(r.pii_blocked, true, leak);
    assert.equal(calls.length, 0, leak);
  }
});

test('tanpa LLM_API_KEY: templat dipakai, memuat "perlu diperiksa", tanpa menyimpulkan fraud', async () => {
  const calls = [];
  const r = await createExplainer({ llm: { ...llm, apiKey: '' }, screen, fetchImpl: spy(calls) }).explain(CASE);
  assert.equal(r.source, 'template');
  assert.equal(calls.length, 0);
  assert.match(r.text, /perlu diperiksa/i);
  assert.doesNotMatch(r.text, /\bfraud\b/i);
});

test('payload ke LLM hanya berisi field yang diizinkan', async () => {
  const calls = [];
  const r = await createExplainer({ llm, screen, fetchImpl: spy(calls) }).explain(CASE);
  assert.equal(r.source, 'llm');
  const data = JSON.parse(calls[0].messages[0].content.match(/<data_kasus>\n([\s\S]*)\n<\/data_kasus>/)[1]);
  const ALLOWED = ['token_pasien', 'diagnosis_kode', 'prosedur_kode', 'nominal_klaim', 'tanggal_masuk', 'skor_risiko', 'tingkat_risiko', 'faskes_terkait', 'modus', 'skor_detektor', 'alasan_detektor', 'fitur_teratas_ml', 'risiko_faskes', 'fitur'];
  assert.deepEqual(Object.keys(data).filter((k) => !ALLOWED.includes(k)), []);
  assert.equal(data.risiko_faskes, 0.64);
  assert.deepEqual(data.fitur_teratas_ml, [['faskes:billed_mean', 0.2]]);
  const sent = JSON.stringify(calls[0]);
  for (const secret of ['Budi Santoso', '9999000011112222', '081234567890', '1943-01-01']) assert.ok(!sent.includes(secret), secret);
  assert.deepEqual(scanForPii(Object.values(casePayload(CASE))), []);
});
