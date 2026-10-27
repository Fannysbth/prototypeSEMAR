// T4: REPEAT_BILLING memakai jendela 90 hari (diagnosis + tindakan + faskes + nominal sama), lewat engine nyata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../shared/store.js';
import { createEngine } from '../../services/fraud/engine.js';
import { addDays } from '../../shared/synthetic.js';

async function newEngine() {
  const st = await createStore({ driver: 'memory', namespace: 'rb' });
  return createEngine({ observations: await st.collection('o'), cases: await st.collection('c') });
}
const base = { facility_id: 'RS-A', fraud_ref: 'PSE_FRD_AAAAAAAAAAAAAAAAAAAA', diagnosis_code: 'J18.9', procedure_code: '87.44', claim_type: 'RI', length_of_stay: 4, amount: 6200000 };
const repeatAfter = async (days, over = {}) => {
  const e = await newEngine();
  await e.analyze({ ...base, claim_id: 'RB-1', admit_date: '2026-03-01' });
  const r = await e.analyze({ ...base, ...over, claim_id: 'RB-2', admit_date: addDays('2026-03-01', days) });
  return r.flags.map((f) => f.modus);
};

test('klaim identik 60 hari kemudian di faskes yang sama ditandai REPEAT_BILLING', async () => {
  assert.ok((await repeatAfter(60)).includes('REPEAT_BILLING'));
  assert.ok((await repeatAfter(38)).includes('REPEAT_BILLING'));
});

test('di luar 90 hari tidak ditandai', async () => {
  assert.ok(!(await repeatAfter(95)).includes('REPEAT_BILLING'));
});

test('faskes, tindakan, atau diagnosis berbeda tidak dianggap klaim ganda', async () => {
  assert.ok(!(await repeatAfter(60, { facility_id: 'RS-B' })).includes('REPEAT_BILLING'));
  assert.ok(!(await repeatAfter(60, { procedure_code: '99.21' })).includes('REPEAT_BILLING'));
  assert.ok(!(await repeatAfter(60, { diagnosis_code: 'A09', procedure_code: '99.18' })).includes('REPEAT_BILLING'));
});
