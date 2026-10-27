// Frontend tipis SAMAR: login, unggah CSV, kasus, dashboard + simulasi, audit. Semua teks lewat textContent (tanpa innerHTML).
const $ = (id) => document.getElementById(id);
const state = { token: null, user: null, tab: null, config: null };
try { const s = JSON.parse(sessionStorage.getItem('samar') || 'null'); if (s) Object.assign(state, s); } catch { /* sessionStorage tidak tersedia */ }
const save = () => { try { sessionStorage.setItem('samar', JSON.stringify({ token: state.token, user: state.user, tab: state.tab })); } catch { /* abaikan */ } };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const fmtTime = (ms) => new Date(ms).toLocaleString('id-ID');
const badge = (lvl) => h('span', { class: `badge ${lvl}` }, lvl);

async function api(path, { method = 'GET', body, raw, type = 'application/json' } = {}) {
  const res = await fetch(`/api/v1${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': type } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) }, body: body === undefined ? undefined : (type === 'application/json' ? JSON.stringify(body) : body) });
  if (res.status === 401 && state.token) { logout('Sesi berakhir, silakan masuk lagi.'); throw new Error('Sesi berakhir'); }
  if (raw) { if (!res.ok) throw new Error(`Gagal (${res.status})`); return res; }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Gagal (${res.status})`);
  return json;
}
async function download(path, name) {
  const blob = await (await api(path, { raw: true })).blob();
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}
const note = (el, text, ok = false) => { el.replaceChildren(h('div', { class: `msg ${ok ? 'ok' : 'err'}` }, text)); };

function logout(msg) { state.token = null; state.user = null; save(); render(msg); }

const TABS = {
  facility: [['unggah', 'Unggah CSV']],
  verifier: [['kasus', 'Kasus'], ['unggah', 'Unggah CSV'], ['dashboard', 'Dashboard']],
  auditor: [['kasus', 'Kasus'], ['dashboard', 'Dashboard & simulasi'], ['evaluasi', 'Evaluasi']],
  admin: [['dashboard', 'Dashboard & simulasi'], ['audit', 'Audit & pengaturan'], ['evaluasi', 'Evaluasi']],
};
const ROLE_LABEL = { facility: 'Faskes', verifier: 'Verifikator', auditor: 'Auditor', admin: 'Admin / DPO' };

function renderHeader() {
  const top = $('top'); top.replaceChildren(h('span', { class: 'brand' }, 'SAMAR'));
  if (!state.user) return;
  const tabs = TABS[state.user.role];
  top.append(h('nav', {}, tabs.map(([id, label]) => h('button', { class: state.tab === id ? 'active' : '', onclick: () => { state.tab = id; save(); render(); } }, label))),
    h('span', { class: 'muted' }, `${state.user.name} (${ROLE_LABEL[state.user.role]})`), h('a', { class: 'btn alt', href: '/docs', target: '_blank', rel: 'noopener' }, 'API /docs'), h('button', { class: 'btn alt', onclick: () => logout() }, 'Keluar'));
}

async function viewLogin(msg) {
  const out = h('div'); if (msg) note(out, msg);
  const u = h('input', { id: 'u', autocomplete: 'username' }); const p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password' });
  const submit = async (username, password) => {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password } });
      state.token = r.token; state.user = r.user; state.tab = TABS[r.user.role][0][0]; save(); render();
    } catch (e) { note(out, e.message); }
  };
  const demo = h('div');
  try {
    state.config = await (await fetch('/api/config')).json();
    if (state.config.demo_mode) {
      const { items } = await (await fetch('/api/v1/auth/demo-users')).json();
      demo.append(h('h3', {}, 'Akun demo (data sintetis)'), h('div', { class: 'row' }, items.filter((x) => x.role !== 'facility' || x.facility_id === 'RS-A').map((x) => h('button', { class: 'btn alt', onclick: () => submit(x.username, x.password) }, `${ROLE_LABEL[x.role]}: ${x.username}`))));
    }
  } catch { /* demo tidak tersedia */ }
  $('view').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Masuk'),
    h('div', { class: 'row' }, h('div', {}, h('label', { for: 'u' }, 'Nama pengguna'), u), h('div', {}, h('label', { for: 'p' }, 'Kata sandi'), p), h('button', { class: 'btn', onclick: () => submit(u.value, p.value) }, 'Masuk')), out, demo));
}

function viewUnggah() {
  const out = h('div'); const file = h('input', { type: 'file', accept: '.csv,text/csv' });
  const send = h('button', { class: 'btn', onclick: async () => {
    if (!file.files[0]) return note(out, 'Pilih file CSV dulu.');
    send.disabled = true; note(out, 'Mengunggah dan menganalisis...', true);
    try {
      const b = await api('/claims/upload', { method: 'POST', body: await file.files[0].text(), type: 'text/csv' });
      out.replaceChildren(h('div', { class: 'msg ok' }, `Batch ${b.batch_id}: ${b.total} baris, ${b.accepted} diterima, ${b.rejected} ditolak, ${b.cases} kasus berisiko dibuat.`),
        b.errors.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, h('th', {}, 'Baris'), h('th', {}, 'Alasan')), b.errors.map((e) => h('tr', {}, h('td', {}, e.row), h('td', {}, e.message))))) : null);
    } catch (e) { note(out, e.message); } finally { send.disabled = false; }
  } }, 'Unggah');
  $('view').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Unggah klaim (CSV)'),
    h('p', { class: 'muted' }, 'Kolom: claim_ref, facility_id, patient_nik, patient_name, phone, birth_date, record_number, diagnosis_code, procedure_code, claim_type, admit_date, length_of_stay, amount. Header kode BPJS (PSTV01, FKL02, FKL47) juga diterima. Identitas peserta diganti token sebelum masuk zona analitik. Hanya data sintetis.'),
    h('div', { class: 'row' }, h('div', {}, file), send), out));
}

const STATUSES = ['BARU', 'DITINJAU', 'BUTUH_INFO', 'TERKONFIRMASI', 'DITOLAK_FALSE_POSITIVE', 'SELESAI'];
async function viewKasus() {
  const f = { risk: '', status: '', modus: '', faskes: '' };
  const list = h('div'); const detail = h('div');
  const sel = (key, label, opts) => h('div', {}, h('label', {}, label), h('select', { onchange: (e) => { f[key] = e.target.value; load(); } }, h('option', { value: '' }, 'Semua'), opts.map((o) => h('option', { value: o }, o))));
  async function load() {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    try {
      const { items: found } = await api(`/cases${q ? `?${q}` : ''}`);
      const items = [...found].sort((a, b) => b.risk_score - a.risk_score || b.created_ms - a.created_ms);
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, ['Kasus', 'Risiko', 'Skor', 'Modus', 'Faskes', 'Status', 'Nominal'].map((x) => h('th', {}, x))),
        items.map((c) => h('tr', { class: 'click', onclick: () => open(c.case_id) }, h('td', { class: 'mono' }, c.case_id), h('td', {}, badge(c.risk_level)), h('td', {}, c.risk_score), h('td', {}, c.modi.join(', ')), h('td', {}, c.facilities.join(', ')), h('td', {}, c.status), h('td', {}, rp(c.amount)))))),
      ...(items.length ? [] : [h('p', { class: 'muted' }, 'Belum ada kasus. Unggah CSV terlebih dahulu.')]));
    } catch (e) { note(list, e.message); }
  }
  async function open(id) {
    try {
      const c = await api(`/cases/${encodeURIComponent(id)}`);
      const expl = h('p', {}, c.explanation || 'Membuat penjelasan...'); const src = h('span', { class: 'badge' }, c.explanation_source || '-');
      if (!c.explanation) api(`/cases/${encodeURIComponent(id)}/explain`, { method: 'POST', body: {} }).then((r) => { expl.textContent = r.explanation; src.textContent = r.explanation_source; }).catch((e) => { expl.textContent = e.message; });
      const msg = h('div'); const status = h('select', {}, STATUSES.map((s) => h('option', { value: s, selected: s === c.status }, s))); const nt = h('input', { placeholder: 'Catatan perubahan' });
      const reveal = state.user.role === 'auditor' ? (() => { const why = h('textarea', { rows: 2, placeholder: 'Alasan pembukaan identitas (minimal 20 karakter)' }); const out = h('div'); return h('div', {}, h('h3', {}, 'Buka identitas (terkontrol, teraudit)'), why, h('button', { class: 'btn alt', onclick: async () => { try { const r = await api(`/cases/${encodeURIComponent(id)}/reveal`, { method: 'POST', body: { reason: why.value } }); note(out, `Identitas peserta: ${r.patient_nik}. ${r.note}`, true); } catch (e) { note(out, e.message); } } }, 'Buka identitas'), out); })() : null;
      detail.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `Kasus ${c.case_id}`),
        h('p', {}, badge(c.risk_level), ` skor ${c.risk_score} · ${c.diagnosis_code} · ${rp(c.amount)} · estimasi berlebih ${rp(c.excess_amount)} · status ${c.status}`),
        h('p', { class: 'muted' }, 'Token pasien: ', h('span', { class: 'mono' }, c.fraud_ref)), c.ml_status === 'unavailable' ? h('div', { class: 'msg err' }, 'ML tidak tersedia: skor hanya dari detektor aturan.') : null,
        h('h3', {}, 'Alasan deteksi'), h('ul', { class: 'plain' }, c.flags.map((x) => h('li', {}, `${x.modus}: ${x.reason}`))),
        h('h3', {}, 'Riwayat token lintas faskes'), h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, ['Klaim', 'Faskes', 'Masuk', 'Lama rawat', 'Diagnosis', 'Nominal'].map((x) => h('th', {}, x))),
          c.history.map((x) => h('tr', {}, h('td', { class: 'mono' }, x.claim_id), h('td', {}, x.facility_id), h('td', {}, x.admit_date), h('td', {}, `${x.length_of_stay} hari`), h('td', {}, x.diagnosis_code), h('td', {}, rp(x.amount)))))),
        h('h3', {}, 'Penjelasan ', src), expl,
        h('h3', {}, 'Ubah status'), h('div', { class: 'row' }, h('div', {}, status), h('div', {}, nt), h('button', { class: 'btn', onclick: async () => { try { await api(`/cases/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: status.value, note: nt.value || undefined } }); load(); open(id); } catch (e) { note(msg, e.message); } } }, 'Simpan')), msg,
        h('h3', {}, 'Riwayat status'), h('ul', { class: 'plain' }, c.events.map((e) => h('li', {}, `${fmtTime(e.at_ms)} · ${e.actor}: ${e.from_status ?? '-'} → ${e.to_status}${e.note ? ` (${e.note})` : ''}`))), reveal));
      detail.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { note(detail, e.message); }
  }
  $('view').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Antrian kasus berisiko'),
    h('div', { class: 'row' }, sel('risk', 'Risiko', ['HIGH', 'MEDIUM', 'LOW']), sel('status', 'Status', STATUSES), sel('modus', 'Modus', ['SELF_REFERRAL', 'PHANTOM_BILLING', 'CLONING', 'UPCODING', 'UNBUNDLING', 'REPEAT_BILLING', 'PROLONGED_LOS', 'ML_ANOMALY', 'ML_SUPERVISED']), sel('faskes', 'Faskes', (state.config?.facilities ?? []).map((x) => x.id))), list), detail);
  load();
}

function bars(title, obj) {
  const max = Math.max(1, ...Object.values(obj || {}));
  return h('div', {}, h('h3', {}, title), Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'row' }, h('div', {}, `${k} (${v})`), h('div', {}, (() => { const b = h('div', { class: 'bar' }); b.style.width = `${(100 * v) / max}%`; return b; })()))));
}
async function viewDashboard() {
  const box = h('div'); $('view').replaceChildren(box);
  try {
    const d = await api('/dashboard/summary');
    box.append(h('div', { class: 'card' }, h('h2', {}, 'Ringkasan'), h('div', { class: 'grid' }, [['Klaim dianalisis', d.claims_total], ['Kasus', d.cases_total], ['Estimasi rupiah berlebih', rp(d.excess_total_estimate)], ['Token aktif', d.tokens_active], ['Token dicabut', d.tokens_revoked], ['Identitas dibuka', d.reveal_success]].map(([l, v]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l)))),
      bars('Kasus per tingkat risiko', d.cases_by_level), bars('Kasus per modus', d.cases_by_modus), bars('Kasus per faskes', d.cases_by_facility), bars('Kasus per status', d.cases_by_status),
      h('p', { class: 'muted' }, 'Rupiah berlebih adalah estimasi dari aturan deteksi, bukan angka audit.')));
  } catch (e) { box.append(h('div', { class: 'card' }, h('div', { class: 'msg err' }, e.message))); }
  if (!['auditor', 'admin'].includes(state.user.role)) return;
  const inp = (id, label, val) => h('div', {}, h('label', {}, label), h('input', { id, value: val, inputmode: 'decimal' }));
  const out = h('div'); const scen = h('div', { class: 'row' });
  const FIELDS = ['annual_claim_value', 'fraud_rate', 'rupiah_recall', 'recovery_rate', 'biaya_operasional'];
  const fill = (inputs) => FIELDS.forEach((k) => { $(k).value = String(inputs[k]); });
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Simulasi dampak rupiah ', h('span', { class: 'badge' }, 'asumsi')),
    h('p', { class: 'muted' }, 'Semua angka adalah asumsi yang bisa diubah. Rupiah recall berasal dari hasil npm run evaluate pada data sintetis (kapasitas review 1% adalah asumsi). Biaya = estimasi pilot 1 cabang setahun dari docs/07-model-bisnis.md, bukan penawaran.'),
    scen,
    h('div', { class: 'row' }, inp('annual_claim_value', 'Nilai klaim tahunan cabang (Rp)', ''), inp('fraud_rate', 'fraud_rate (0-1)', ''), inp('rupiah_recall', 'rupiah_recall (0-1)', '')),
    h('div', { class: 'row' }, inp('recovery_rate', 'recovery_rate (0-1)', ''), inp('biaya_operasional', 'Biaya operasional setahun (Rp)', '')),
    h('button', { class: 'btn', onclick: async () => {
      const body = Object.fromEntries(FIELDS.map((k) => [k, Number($(k).value)]));
      if (FIELDS.some((k) => $(k).value === '')) return note(out, 'Isi semua kolom atau pilih skenario.');
      try { const r = await api('/impact/simulate', { method: 'POST', body }); out.replaceChildren(h('div', { class: 'grid' }, Object.entries(r.result).map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, k.endsWith('_rp') ? rp(v) : String(v ?? '-')), h('span', {}, k)))), h('h3', {}, 'Asumsi'), h('ul', { class: 'plain' }, r.assumptions.map((a) => h('li', {}, a)))); } catch (e) { note(out, e.message); }
    } }, 'Hitung'), out,
    state.user.role === 'auditor' ? h('p', {}, h('button', { class: 'btn alt', onclick: () => download('/reports/cases.csv', 'cases.csv').catch((e) => note(out, e.message)) }, 'Unduh laporan kasus (CSV)')) : null));
  try {
    const { scenarios } = await api('/impact/scenarios');
    scen.append(...scenarios.map((x) => h('button', { class: 'btn alt', onclick: () => fill(x.inputs) }, `Skenario ${x.title}`)));
    const mid = scenarios.find((x) => x.id === 'sedang'); if (mid) fill(mid.inputs);
  } catch (e) { scen.append(h('span', { class: 'muted' }, `${e.message} Isi manual.`)); }
}

const f1 = (x, d = 1) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(d)}%`);
const statTxt = (s) => (s ? `${f1(s.mean)} (${f1(s.min)}-${f1(s.max)})` : '-');
const tbl = (head, rows) => h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, head.map((x) => h('th', {}, x))), rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
const VARIAN = { full: 'SAMAR lengkap', no_ml: 'Tanpa ML (aturan saja)', no_rules: 'Tanpa aturan (ML saja)', no_cross: 'Tanpa fitur lintas faskes' };

async function viewEvaluasi() {
  const box = h('div'); $('view').replaceChildren(box);
  let m;
  try { m = await api('/evaluation/latest'); } catch (e) { box.append(h('div', { class: 'card' }, h('div', { class: 'msg err' }, `${e.message} Jalankan: npm run evaluate`))); return; }
  const d = m.detection; const p = m.stack; const pr = m.protocol;
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Evaluasi (data sintetis)'),
    h('div', { class: 'msg err' }, 'Angka ini dari data sintetis dengan label dari generator; kapasitas review 1% adalah asumsi. Ini bukti mekanisme, bukan akurasi pada data JKN riil.'),
    h('p', { class: 'muted' }, `${pr.seeds.length} seed x fraud rate ${pr.fraud_rates.map((x) => `${x * 100}%`).join('/')} x 2 tingkat kesulitan. Latih hari 0-${pr.train_days - 1} (bulan 1-4), uji bulan 5-6. Modus hold-out: ${pr.holdout_modus}. Angka = rerata (min-maks) antar run. Dibuat ${new Date(m.generated_at).toLocaleString('id-ID')}.`),
    ...['standard', 'hard'].flatMap((df) => [h('h3', {}, df === 'standard' ? 'Set standar' : 'Set hard (skenario lebih sulit)'),
      tbl(['Varian', 'precision@1%', 'recall@1%', 'rupiah recall@1%', 'PR-AUC', 'ROC-AUC'], Object.entries(VARIAN).map(([v, name]) => { const x = d.summary[df][v]; return [name, statTxt(x.precision_at_1pct), statTxt(x.recall_at_1pct), statTxt(x.rupiah_recall_at_1pct), x.pr_auc ? x.pr_auc.mean.toFixed(3) : '-', x.roc_auc ? x.roc_auc.mean.toFixed(3) : '-']; }))]),
    d.saturation_note ? h('p', { class: 'muted' }, d.saturation_note) : null,
    h('p', { class: 'muted' }, 'Ablasi: bandingkan baris "SAMAR lengkap" dengan "Tanpa fitur lintas faskes", "Tanpa ML", dan "Tanpa aturan" pada tabel di atas.')));
  const ho = (df, v) => { const x = d.holdout[df][v]; return x ? `${f1(x.recall)} [${f1(x.ci95.lo)}-${f1(x.ci95.hi)}], n=${x.n}` : '-'; };
  box.append(h('div', { class: 'card' }, h('h2', {}, `Modus hold-out: ${pr.holdout_modus}`), h('p', { class: 'muted' }, 'Tidak dipakai melatih model supervised. Recall pada ambang kasus (skor >= 45), gabungan semua run, CI Wilson 95%.'),
    tbl(['Varian', 'Set standar', 'Set hard'], ['full', 'no_rules', 'no_cross', 'no_ml'].map((v) => [VARIAN[v], ho('standard', v), ho('hard', v)]))));
  const pii = p.privacy;
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Tanpa SAMAR vs dengan SAMAR'),
    tbl(['Ukuran', 'Tanpa SAMAR (baseline)', 'Dengan SAMAR'], [
      ['Paritas deteksi (skor + modus identik)', '-', `${p.parity.pct.toFixed(1)}% (${p.parity.identical}/${p.parity.total} klaim)`],
      ['Precision / recall pada ambang kasus', `${f1(p.detection.baseline.precision)} / ${f1(p.detection.baseline.recall)}`, `${f1(p.detection.proposed.precision)} / ${f1(p.detection.proposed.recall)}`],
      ['Payload zona token yang memuat PII', `${pii.baseline.pct_with_pii.toFixed(0)}%`, `${pii.proposed.pct_with_pii.toFixed(0)}%`],
      ['Latensi unggah klaim p95', `${p.performance.baseline.p95_ms} ms`, `${p.performance.proposed.p95_ms} ms`],
      ['Latensi POST /verify p95', '-', `${p.verify.p95_ms} ms`],
      ['Throughput unggah CSV', '-', `${p.upload.rows_per_sec} baris/detik`]]),
    h('h3', {}, 'Paparan PII per zona'),
    tbl(['Zona / layanan', 'Payload baseline', 'Mengandung PII', 'Payload SAMAR', 'Mengandung PII'], Object.keys(pii.baseline.services).map((k) => [k, pii.baseline.services[k].payloads, pii.baseline.services[k].with_pii, pii.proposed.services[k].payloads, pii.proposed.services[k].with_pii])),
    h('p', { class: 'muted' }, `Gateway, privacy, dan vault memegang data pribadi by design. ${p.security.rejected}/${p.security.total} percobaan akses tidak sah ditolak; ${p.functional.passed}/${p.functional.total} uji fungsional lulus.`)));
  const ev = m.evidence_card;
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Evidence card (eval-kit)'),
    ev.ran ? h('div', {}, ...['evidence.html', 'evidence-hard.html'].flatMap((f) => [h('h3', {}, f === 'evidence.html' ? 'Set standar' : 'Set hard'),
      h('iframe', { src: `/api/v1/evaluation/evidence?file=${f}&access_token=${encodeURIComponent(state.token)}`, title: f, class: 'evidence', sandbox: 'allow-scripts' })]),
      h('h3', {}, 'Temuan keterbatasan otomatis dari kit'), h('ul', { class: 'plain' }, (ev.limitations.length ? ev.limitations : ['(tidak ada butir)']).map((x) => h('li', {}, x))))
      : h('div', { class: 'msg err' }, `Evidence card belum dibuat: ${ev.reason}`)));
}

async function viewAudit() {
  const box = h('div'); $('view').replaceChildren(box);
  const msg = h('div');
  const field = (id, label) => h('div', {}, h('label', {}, label), h('input', { id }));
  const run = (fn) => async () => { try { await fn(); } catch (e) { note(msg, e.message); } };
  const th = await api('/settings/threshold').catch(() => ({ case_score: '?' }));
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Pengaturan dan tindakan admin'), msg,
    h('div', { class: 'row' }, field('thr', `Ambang kasus (sekarang ${th.case_score})`), h('button', { class: 'btn', onclick: run(async () => { const r = await api('/settings/threshold', { method: 'PUT', body: { case_score: Number($('thr').value) } }); note(msg, `Ambang kasus menjadi ${r.case_score}.`, true); viewAudit(); }) }, 'Ubah ambang')),
    h('div', { class: 'row' }, field('rv', 'Token peserta yang dicabut (PSE_FRD_...)'), h('button', { class: 'btn alt', onclick: run(async () => { const r = await api('/tokens/revoke', { method: 'POST', body: { subject_token: $('rv').value.trim() } }); note(msg, `${r.revoked} token dicabut. Klaim baru dari peserta ini ditolak di analitik.`, true); }) }, 'Cabut token')),
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: run(async () => { const r = await api('/keys/rotate', { method: 'POST', body: {} }); note(msg, `Epoch baru dimulai (rotasi ke-${r.rotation}). Token baru berbeda dari token sebelumnya.`, true); }) }, 'Rotasi epoch'),
      h('button', { class: 'btn alt', onclick: run(async () => { const r = await api('/audit/verify'); note(msg, r.valid ? `Rantai audit valid (${r.entries} entri).` : `Rantai audit RUSAK pada entri ${r.broken_at}.`, r.valid); }) }, 'Verifikasi rantai audit'),
      h('button', { class: 'btn alt', onclick: run(() => download('/export/evalkit', 'evalkit.zip')) }, 'Unduh eval-kit'))));
  try {
    const { items } = await api('/audit?limit=100');
    box.append(h('div', { class: 'card' }, h('h2', {}, 'Log audit (100 terbaru)'), h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, ['#', 'Waktu', 'Aksi', 'Status', 'Aktor', 'Kasus/target', 'Alasan', 'Hash'].map((x) => h('th', {}, x))),
      items.map((a) => h('tr', {}, h('td', {}, a.seq), h('td', {}, fmtTime(a.ts_ms)), h('td', {}, a.action), h('td', {}, a.status), h('td', {}, `${a.actor ?? '-'}${a.actor_role ? ` (${a.actor_role})` : ''}`), h('td', { class: 'mono' }, a.case_id ?? '-'), h('td', {}, a.reason ?? (a.justification_len ? `alasan ${a.justification_len} karakter (isi tidak disimpan)` : '-')), h('td', { class: 'mono' }, (a.hash ?? '').slice(0, 10))))))));
  } catch (e) { box.append(h('div', { class: 'card' }, h('div', { class: 'msg err' }, e.message))); }
}

async function render(msg) {
  renderHeader();
  if (!state.user) return viewLogin(msg);
  if (!state.config) state.config = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  const views = { unggah: viewUnggah, kasus: viewKasus, dashboard: viewDashboard, audit: viewAudit, evaluasi: viewEvaluasi };
  if (!TABS[state.user.role].some(([id]) => id === state.tab)) state.tab = TABS[state.user.role][0][0];
  return views[state.tab]();
}
render();
