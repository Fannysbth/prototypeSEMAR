// Evaluasi sistem lewat tumpukan layanan nyata (baseline vs proposed): paritas deteksi, paparan PII, kinerja, /verify, unggah, keamanan, fungsional.
// Dipanggil oleh scripts/evaluate.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { startStack } from '../stack.js';
import { ROOT } from '../../shared/config.js';
import { buildDataset } from '../../shared/synthetic.js';
import { toCsv } from '../../shared/csv.js';
import { CLAIM_COLUMNS } from '../generate-data/index.js';
import { FACILITIES } from '../../shared/reference.js';
import { scanForPii } from '../../shared/pii.js';

const KEY = 'eval-internal-key-'.padEnd(48, 'k');
const ENV = {
  STORE: 'memory', DEMO_MODE: 'true', SYNTHETIC_ONLY: 'true', NODE_ENV: 'test', LOG_LEVEL: 'error', TAP_MAX: '5000',
  JWT_SECRET: 'eval-jwt-secret'.padEnd(48, 'j'), HMAC_MASTER_KEY: 'eval-master-key'.padEnd(48, 'm'), INTERNAL_API_KEY: KEY,
  PORT: '5400', AUTH_PORT: '5401', PRIVACY_PORT: '5402', CLAIMS_PORT: '5403', FRAUD_PORT: '5404', NOTIFY_PORT: '5405', ML_PORT: '5406', ML_ENABLED: 'true', LLM_API_KEY: '',
  RATE_LIMIT_PER_MIN: '1000000', VERIFY_RATE_LIMIT_PER_MIN: '1000000', LOGIN_MAX_FAILS_PER_MIN: '8', REIDENTIFY_MAX_PER_HOUR: '5',
  AUTH_USERS_JSON: '', ALLOWED_ORIGIN: '', TRUST_PROXY: '0', TOKEN_TTL_SECONDS: '2592000', HOST: '127.0.0.1', AUTH_URL: '', PRIVACY_URL: '', CLAIMS_URL: '', FRAUD_URL: '', NOTIFY_URL: '',
};
const SEED = 2026;
const log = (m) => console.log(m);
const pctile = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const round = (n, d = 1) => +Number(n).toFixed(d);

function client(base) {
  return async (p, { method = 'GET', body, token, headers = {} } = {}) => {
    const t0 = performance.now();
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch { /* kosong */ }
    return { status: res.status, json, ms: performance.now() - t0 };
  };
}
async function pool(items, concurrency, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (i < items.length) { const k = i; i += 1; await worker(items[k], k); } }));
}
const auc = (pos, neg) => { let w = 0; for (const p of pos) for (const n of neg) w += p > n ? 1 : p === n ? 0.5 : 0; return pos.length && neg.length ? w / (pos.length * neg.length) : null; };

async function runMode(mode, dataset) {
  log(`\n=== Mode ${mode.toUpperCase()} ===`);
  const stack = await startStack({ env: ENV, quiet: true });
  const api = client(stack.baseUrl);
  const out = { mode, functional: [], security: [] };
  try {
    const tokens = {};
    for (const f of FACILITIES) tokens[f.id] = (await api('/api/auth/login', { method: 'POST', body: { username: `rs.${f.name.split(' ')[1].toLowerCase()}`, password: `demo-${f.name.split(' ')[1].toLowerCase()}` } })).json.token;
    const ver = (await api('/api/auth/login', { method: 'POST', body: { username: 'verifikator', password: 'demo-verifikator' } })).json.token;
    const aud = (await api('/api/auth/login', { method: 'POST', body: { username: 'auditor', password: 'demo-auditor' } })).json.token;
    const adm = (await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'demo-admin' } })).json.token;
    const fn = (name, pass) => out.functional.push({ name, pass: !!pass });
    // Paritas hanya bermakna bila layanan ml siap di kedua mode.
    for (let i = 0; i < 90 && !out.ml_ready; i += 1) { out.ml_ready = (await api('/api/health')).json?.ml?.available === true; if (!out.ml_ready) await new Promise((r) => setTimeout(r, 1000)); }
    log(`  layanan ml siap: ${out.ml_ready}`);
    fn('Semua layanan siap (/api/ready)', (await api('/api/ready')).status === 200);
    fn('Login faskes & verifikator menghasilkan JWT', Object.values(tokens).every(Boolean) && !!ver);

    // ---- 1) Deteksi pada dataset berlabel (berurutan kronologis) ----
    log(`  Mengirim ${dataset.length} klaim sintetis...`);
    const results = [];
    for (let i = 0; i < dataset.length; i += 1) {
      const it = dataset[i];
      const r = await api(`/api/claims?mode=${mode}`, { method: 'POST', token: tokens[it.facility_id], body: it.claim });
      if (r.status !== 201) throw new Error(`klaim #${i} gagal (${r.status}): ${JSON.stringify(r.json)}`);
      results.push({ score: r.json.fraud.risk_score, ml: r.json.fraud.ml_score, modi: [...new Set(r.json.fraud.flags.map((f) => f.modus))].sort(), label: it.label });
    }
    fn('Klaim valid diterima & dianalisis (201)', results.length === dataset.length);
    let tp = 0; let fp = 0; let fnn = 0; let tn = 0; const per = {};
    for (const r of results) {
      const pred = r.score >= 45; const truth = r.label.fraud;
      if (pred && truth) tp += 1; else if (pred && !truth) fp += 1; else if (!pred && truth) fnn += 1; else tn += 1;
      if (truth) { per[r.label.modus] ??= { modus: r.label.modus, n: 0, hit: 0 }; per[r.label.modus].n += 1; if (r.modi.includes(r.label.modus)) per[r.label.modus].hit += 1; }
    }
    const precision = tp + fp ? tp / (tp + fp) : 0; const recall = tp + fnn ? tp / (tp + fnn) : 0;
    out.detection = {
      tp, fp, fn: fnn, tn, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      per_modus: Object.values(per).map((x) => ({ ...x, recall: x.hit / x.n })),
      ml_only_auc: auc(results.filter((r) => r.label.fraud).map((r) => r.ml), results.filter((r) => !r.label.fraud).map((r) => r.ml)),
    };
    out.raw = results.map((r) => ({ score: r.score, modi: r.modi }));
    log(`  precision ${round(precision * 100)}%  recall ${round(recall * 100)}%  (TP ${tp} FP ${fp} FN ${fnn} TN ${tn})`);

    // ---- 2) Paparan PII per layanan (dari rekaman payload di tiap layanan) ----
    const known = new Map();
    for (const it of dataset) {
      known.set(it.claim.patient_nik, 'nik'); known.set(it.claim.patient_name, 'nama'); known.set(it.claim.phone, 'telepon');
      known.set(it.claim.birth_date, 'tgl_lahir'); known.set(it.claim.record_number, 'no_rekam_medis');
    }
    const services = {};
    for (const svc of ['claims', 'fraud', 'notify']) {
      const items = (await api(`/api/demo/tap/${svc}`, { token: ver })).json.items;
      const cat = {}; let withPii = 0;
      for (const it of items) { const found = scanForPii(it.body, known); if (found.length) withPii += 1; for (const c of found) cat[c] = (cat[c] || 0) + 1; }
      services[svc] = { payloads: items.length, with_pii: withPii, categories: cat };
    }
    const tot = Object.values(services).reduce((a, s) => ({ p: a.p + s.payloads, w: a.w + s.with_pii }), { p: 0, w: 0 });
    out.privacy = { services, total_payloads: tot.p, total_with_pii: tot.w, pct_with_pii: tot.p ? (tot.w / tot.p) * 100 : 0 };
    log(`  paparan PII ke layanan hilir: ${tot.w}/${tot.p} payload (${round(out.privacy.pct_with_pii)}%)`);
    await api('/api/demo/tap', { method: 'DELETE', token: ver });

    // ---- fungsional lanjutan: kasus, review, reveal, statistik, notifikasi ----
    const cases = (await api('/api/cases', { token: ver })).json.items;
    fn('Kasus berisiko masuk antrean verifikator', cases.length > 0);
    const review = await api(`/api/cases/${cases[0].case_id}/review`, { method: 'POST', token: ver, body: { decision: 'CONFIRMED_FRAUD', note: 'Evaluasi otomatis: dokumen tidak sesuai' } });
    fn('Review verifikator mengubah status kasus (human-in-the-loop)', review.json?.status === 'TERKONFIRMASI');
    fn('Ringkasan statistik tersedia', (await api('/api/stats', { token: ver })).status === 200);
    fn('Notifikasi terkirim ke kotak masuk verifikator', ((await api('/api/notifications', { token: ver })).json?.items || []).length > 0);
    const reveal = await api(`/api/cases/${cases[0].case_id}/reveal`, { method: 'POST', token: aud, body: { justification: 'Evaluasi otomatis: verifikasi akses sah oleh auditor' } });
    fn('Pembukaan identitas sah oleh auditor berhasil (teraudit)', reveal.status === 200 && /^9999\d{12}$/.test(reveal.json.patient_nik || ''));

    // ---- 3) Kinerja ----
    const perf = buildDataset({ seed: 4242, normal: 420, fraud: false }).slice(0, 380);
    for (const it of perf.slice(0, 20)) await api(`/api/claims?mode=${mode}`, { method: 'POST', token: tokens[it.facility_id], body: it.claim }); // pemanasan
    const lat = [];
    for (const it of perf.slice(20, 170)) { const r = await api(`/api/claims?mode=${mode}`, { method: 'POST', token: tokens[it.facility_id], body: it.claim }); if (r.status === 201) lat.push(r.ms); }
    let errors = 0; const conc = perf.slice(170, 370); const t0 = performance.now();
    await pool(conc, 8, async (it) => { const r = await api(`/api/claims?mode=${mode}`, { method: 'POST', token: tokens[it.facility_id], body: it.claim }); if (r.status !== 201) errors += 1; });
    const secs = (performance.now() - t0) / 1000;
    out.performance = { n: lat.length, concurrency: 8, mean_ms: round(lat.reduce((a, b) => a + b, 0) / lat.length), p50_ms: round(pctile(lat, 0.5)), p95_ms: round(pctile(lat, 0.95)), p99_ms: round(pctile(lat, 0.99)), tps: round(conc.length / secs), errors };
    log(`  latensi p50 ${out.performance.p50_ms} ms, p95 ${out.performance.p95_ms} ms, ${out.performance.tps} TPS`);

    // ---- 3b) Latensi /verify dan throughput unggah (khusus proposed; unggah selalu lewat jalur proposed) ----
    if (mode === 'proposed') {
      const vLat = [];
      const hex = () => [...Array(8)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      for (let i = 0; i < 120; i += 1) {
        const r = await api('/api/verify', { method: 'POST', token: ver, body: { claim_id: `EVAL-V-${i}`, level: 'FKRTL', participant_id: `PSTV01-${hex()}`, facility_id: FACILITIES[i % 4].id, admit_date: '2026-10-01', discharge_date: '2026-10-05', diagnosis_primary: 'J18.9', procedures: ['87.44'], billed_amount: 6200000 } });
        if (r.status === 200) vLat.push(r.ms); else if (i === 0) log(`  /verify gagal: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
      }
      out.verify = { n: vLat.length, p50_ms: round(pctile(vLat, 0.5)), p95_ms: round(pctile(vLat, 0.95)), max_ms: round(Math.max(...vLat)) };
      log(`  /verify: p50 ${out.verify.p50_ms} ms, p95 ${out.verify.p95_ms} ms (n=${vLat.length})`);
      const up = buildDataset({ seed: 777, normal: 1000, fraud: false }).slice(0, 1000).map((it, i) => ({ claim_ref: `UPL-${String(i + 1).padStart(6, '0')}`, facility_id: it.facility_id, ...it.claim }));
      const csv = toCsv(up, CLAIM_COLUMNS); const tu = performance.now();
      const ur = await api('/api/claims/upload', { method: 'POST', token: ver, body: csv, headers: { 'content-type': 'text/csv' } });
      const ur2 = ur;
      const secsUp = (performance.now() - tu) / 1000;
      out.upload = { rows: up.length, accepted: ur2.json?.accepted ?? 0, seconds: round(secsUp, 2), rows_per_sec: round((ur2.json?.accepted ?? 0) / secsUp) };
      log(`  unggah: ${out.upload.accepted}/${up.length} baris dalam ${out.upload.seconds} dtk (${out.upload.rows_per_sec} baris/dtk)`);
    }

    // ---- 4) Keamanan (khusus mode proposed) ----
    if (mode === 'proposed') {
      const sec = out.security;
      const add = (kind, name, expected, got, pass) => sec.push({ kind, name, expected, got, pass });
      const st = (r) => r.status;
      const direct = async (svc, p, { method = 'GET', body, headers = {} } = {}) => {
        const res = await fetch(stack.config.urls[svc] + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
        let json = null; try { json = await res.json(); } catch { /* kosong */ }
        return { status: res.status, json };
      };
      const ik = { 'x-internal-key': KEY };
      const nik = '9999000011112222';
      const fraudTok = (await direct('privacy', '/v1/minimize', { method: 'POST', headers: ik, body: { service: 'FRAUD_DETECTION', record: { patient_nik: nik } } })).json.projection.fraud_ref;
      const claimTok = (await direct('privacy', '/v1/minimize', { method: 'POST', headers: ik, body: { service: 'CLAIM_PROCESSING', record: { patient_nik: nik } } })).json.projection.patient_token;
      const reid = (extra = {}, headers = ik) => direct('privacy', '/v1/reidentify', { method: 'POST', headers, body: { pseudonym: fraudTok, requesting_service: 'FRAUD_DETECTION', purpose: 'CROSS_FACILITY_MATCHING', actor: { id: 'eval-actor', role: 'auditor' }, case_id: 'CASE-EVAL', justification: 'Pengujian keamanan otomatis oleh skrip evaluasi', ...extra } });
      const rej = (name, expected, r, okCodes) => add('reject', name, expected, String(st(r)), okCodes.includes(st(r)));

      rej('Akses langsung ke Privacy Service tanpa kunci antar-layanan', '401', await direct('privacy', '/v1/audit'), [401]);
      rej('Akses langsung ke Claim Service tanpa kunci antar-layanan', '401', await direct('claims', '/v1/claims'), [401]);
      rej('Akses langsung ke Fraud Service tanpa kunci antar-layanan', '401', await direct('fraud', '/v1/cases'), [401]);
      const claim0 = dataset[0].claim;
      rej('Kirim klaim tanpa token login', '401', await api('/api/claims', { method: 'POST', body: claim0 }), [401]);
      rej('JWT dimanipulasi (tanda tangan diubah)', '401', await api('/api/cases', { token: `${ver.slice(0, -4)}AAAA` }), [401]);
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"x","role":"verifier"}').toString('base64url')}.`;
      rej('JWT dengan alg=none', '401', await api('/api/cases', { token: none }), [401]);
      rej('Faskes membuka antrean kasus verifikator', '403', await api('/api/cases', { token: tokens['RS-A'] }), [403]);
      rej('Faskes mencoba membuka identitas pasien', '403', await api(`/api/cases/${cases[0].case_id}/reveal`, { method: 'POST', token: tokens['RS-A'], body: { justification: 'Saya ingin melihat identitas pasien ini segera' } }), [403]);
      rej('Auditor membuka identitas tanpa alasan memadai', '400', await api(`/api/cases/${cases[0].case_id}/reveal`, { method: 'POST', token: aud, body: { justification: 'singkat' } }), [400]);
      rej('Verifikator mencoba membuka identitas (hanya auditor)', '403', await api(`/api/cases/${cases[0].case_id}/reveal`, { method: 'POST', token: ver, body: { justification: 'Saya verifikator ingin melihat identitas pasien ini' } }), [403]);
      rej('Re-identifikasi dari layanan peminta yang salah', '403', await reid({ requesting_service: 'CLAIM_PROCESSING' }), [403]);
      rej('Re-identifikasi dengan tujuan (purpose) yang salah', '403', await reid({ purpose: 'CLAIM_STORAGE' }), [403]);
      rej('Token milik Claim Service dipakai untuk akses Fraud (lintas-layanan)', '403', await reid({ pseudonym: claimTok }), [403]);
      rej('Peran non-verifikator meminta re-identifikasi', '403', await reid({ actor: { id: 'eval-fac', role: 'facility' } }), [403]);
      rej('Token kedaluwarsa (jam digeser melewati TTL)', '403', await reid({}, { ...ik, 'x-demo-clock-offset-s': String(31 * 86400) }), [403]);
      let guessed = 0; let accepted = 0;
      for (let i = 0; i < 200; i += 1) {
        const rnd = `PSE_FRD_${[...Array(20)].map(() => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')}`;
        const r = await reid({ pseudonym: rnd, actor: { id: 'attacker-guess', role: 'auditor' } });
        guessed += 1; if (r.status === 200) accepted += 1;
      }
      add('reject', 'Tebak token acak 200x (brute-force pseudonim)', '0 berhasil', `${accepted} berhasil dari ${guessed}`, accepted === 0);
      let quotaHit = null;
      for (let i = 1; i <= 8; i += 1) { const r = await reid({ actor: { id: 'quota-actor', role: 'auditor' } }); if (r.status === 429) { quotaHit = i; break; } }
      add('reject', 'Pembukaan identitas massal oleh satu verifikator (kuota/jam)', '429 setelah 5', quotaHit ? `429 pada percobaan ke-${quotaHit}` : 'tidak dibatasi', quotaHit === 6);
      await direct('privacy', '/v1/revoke', { method: 'POST', headers: ik, body: { subject_id: nik, actor: { id: 'eval-actor' } } });
      rej('Re-identifikasi setelah subjek mencabut persetujuan (UU PDP)', '403', await reid({ actor: { id: 'eval-actor-2', role: 'auditor' } }), [403]);
      rej('Kirim NIK riil (bukan sintetis 9999...)', '400', await api('/api/claims', { method: 'POST', token: tokens['RS-A'], body: { ...claim0, patient_nik: '3273011234567890' } }), [400]);
      rej('Field tak dikenal / mass-assignment', '400', await api('/api/claims', { method: 'POST', token: tokens['RS-A'], body: { ...claim0, role: 'admin' } }), [400]);
      rej('Injeksi SQL pada kode diagnosis', '400', await api('/api/claims', { method: 'POST', token: tokens['RS-A'], body: { ...claim0, diagnosis_code: "J18.9'; DROP TABLE claims;--" } }), [400]);
      const idem = { 'idempotency-key': 'eval-idem-key-12345' };
      await api('/api/claims', { method: 'POST', token: tokens['RS-A'], body: claim0, headers: idem });
      rej('Replay klaim dengan Idempotency-Key sama', '409', await api('/api/claims', { method: 'POST', token: tokens['RS-A'], body: claim0, headers: idem }), [409]);
      let got429 = null;
      for (let i = 1; i <= 14; i += 1) { const r = await api('/api/auth/login', { method: 'POST', body: { username: 'rs.melati', password: `salah-${i}` } }); if (r.status === 429) { got429 = i; break; } }
      add('reject', 'Brute-force password login', '429 setelah 8 gagal', got429 ? `429 pada percobaan ke-${got429}` : 'tidak dibatasi', got429 !== null && got429 <= 10);
      const okReveal = await reid({ actor: { id: 'eval-actor-3', role: 'auditor' }, pseudonym: (await direct('privacy', '/v1/minimize', { method: 'POST', headers: ik, body: { service: 'FRAUD_DETECTION', record: { patient_nik: '9999333344445555' } } })).json.projection.fraud_ref });
      add('allow', 'Pembukaan identitas SAH (peran, layanan, tujuan, alasan benar)', '200', String(okReveal.status), okReveal.status === 200);
      const auditRes = await api('/api/audit?limit=300', { token: adm });
      const auditText = JSON.stringify(auditRes.json);
      const leaked = dataset.some((it) => auditText.includes(it.claim.patient_nik)) || auditText.includes(nik);
      add('property', 'Audit log tidak memuat NIK mentah', 'tidak ada', leaked ? 'BOCOR' : 'tidak ada', auditRes.status === 200 && !leaked);
    }
  } finally { await stack.stop(); }
  return out;
}


export { runMode, SEED, round };
