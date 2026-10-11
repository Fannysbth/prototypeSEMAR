import crypto from 'node:crypto';
import { HttpError } from '../../shared/http.js';
import { PatientFactory, SCENARIOS, SCENARIO_META, addDays, makeRng } from '../../shared/synthetic.js';

export const scenarioList = () => Object.entries(SCENARIO_META).map(([id, title]) => ({ id, title }));

export async function runScenario({ name, mode, pipeline, actor, requestId }) {
  const gen = SCENARIOS[name];
  if (!gen) throw new HttpError(404, 'UNKNOWN_SCENARIO', `Skenario tidak dikenal: ${name}`);
  const rng = makeRng(crypto.randomInt(1, 2 ** 31 - 1));
  const start = addDays(new Date().toISOString().slice(0, 10), -5);
  const steps = [];
  for (const item of gen(rng, new PatientFactory(rng), start)) {
    const r = await pipeline.submitClaim({ claim: item.claim, facility_id: item.facility_id, mode, actor, requestId });
    steps.push({
      step: item.step, facility_id: item.facility_id, claim_id: r.claim_id,
      diagnosis_code: item.claim.diagnosis_code, amount: item.claim.amount, admit_date: item.claim.admit_date, length_of_stay: item.claim.length_of_stay,
      risk_score: r.fraud.risk_score, risk_level: r.fraud.risk_level, modi: [...new Set(r.fraud.flags.map((f) => f.modus))],
      reasons: r.fraud.flags.map((f) => f.reason), case_id: r.fraud.case_id, expected_fraud: item.label.fraud, total_ms: r.timings.total_ms,
    });
  }
  return { scenario: name, title: SCENARIO_META[name], mode, steps };
}
