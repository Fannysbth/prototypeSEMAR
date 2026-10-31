// Integrasi fraud -> ml: ml mati tidak menghentikan analisis, dan ml hanya menerima token + id faskes + angka.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../shared/store.js';
import { createEngine } from '../services/fraud/engine.js';
import { createMlClient } from '../services/fraud/ml-client.js';

let n = 0;
const TOKEN = 'PSE_FRD_0123456789ABCDEF0123';
const CLAIM = { claim_id: 'ML-1', facility_id: 'RS-A', fraud_ref: TOKEN, diagnosis_code: 'J18.9', claim_type: 'RI', admit_date: '2026-09-10', length_of_stay: 4, amount: 6200000 };
const newEngine = async (ml) => {
  const st = await createStore({ driver: 'memory', namespace: `ml${(n += 1)}` });
  return createEngine({ observations: await st.collection('o'), cases: await st.collection('c'), ml });
};

test('ml mati: skor ML = 0, analisis tetap jalan dan ditandai "unavailable"', async () => {
  const engine = await newEngine({ score: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await engine.analyze(CLAIM);
  assert.equal(r.ml_status, 'unavailable');
  assert.deepEqual([r.ml_score, r.sup_score], [0, 0]);
  assert.ok(!r.flags.some((f) => f.modus.startsWith('ML_')));
});

test('klien ml: timeout 2 detik dan payload hanya token, id faskes, fitur numerik', async () => {
  let received; let hang = false;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { received = JSON.parse(b); if (!hang) res.end(JSON.stringify({ if_score: 0.4, sup_score: 0.1, top_features: [] })); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const config = { urls: { ml: `http://127.0.0.1:${srv.address().port}` }, secrets: { INTERNAL_API_KEY: 'k'.repeat(40) } };
  try {
    const engine = await newEngine(createMlClient(config));
    const r = await engine.analyze(CLAIM);
    assert.equal(r.ml_status, 'ok');
    assert.deepEqual(Object.keys(received).sort(), ['faskes_id', 'features', 'subject_token']);
    assert.equal(received.subject_token, TOKEN);
    assert.ok(Object.values(received.features).every((v) => typeof v === 'number'));
    // NIK mentah (mode baseline) tidak boleh diteruskan sebagai subject_token
    await createMlClient(config).score({ n_faskes_30d: 1 }, { subject_token: '9999000011112222', faskes_id: 'RS-A' });
    assert.equal(received.subject_token, undefined);
    hang = true;
    const t0 = Date.now();
    await assert.rejects(createMlClient(config, { timeoutMs: 300 }).score({ n_faskes_30d: 1 }, { faskes_id: 'RS-A' }));
    assert.ok(Date.now() - t0 < 1500);
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
