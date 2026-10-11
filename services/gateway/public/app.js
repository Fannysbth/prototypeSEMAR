/* SAMAR UI - JavaScript murni, tanpa build. Semua konten dinamis memakai textContent (aman dari XSS, patuh CSP). */
(() => {
  const API = window.SAMAR_API_BASE || '';
  const PII_KEYS = new Set(['patient_nik', 'patient_name', 'phone', 'birth_date', 'record_number']);
  const RE_NIK = /(?<![A-Za-z0-9])\d{16}(?![A-Za-z0-9])/;
  const state = { config: null, token: sessionStorage.getItem('samar_token'), user: JSON.parse(sessionStorage.getItem('samar_user') || 'null'), mode: sessionStorage.getItem('samar_mode') || 'proposed', tab: null, selectedCase: null };

  const $ = (id) => document.getElementById(id);
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') value = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value;
    return el;
  };
  const rp = (n) => `Rp${Math.round(Number(n)).toLocaleString('id-ID')}`;
  const fmtTime = (ms) => new Date(Number(ms)).toLocaleString('id-ID', { hour12: false });

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg; t.className = `toast show${isErr ? ' err' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3800);
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(auth && state.token ? { authorization: `Bearer ${state.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* kosong */ }
    if (!res.ok) {
      if (res.status === 401 && state.token && !path.startsWith('/api/auth')) { logout(); toast('Sesi berakhir, silakan login lagi', true); }
      const e = data && data.error;
      const detail = e && e.details && e.details.map((d) => `${d.field}: ${d.message}`).join('; ');
      const err = new Error(detail || (e && e.message) || `Permintaan gagal (${res.status})`);
      err.status = res.status; err.code = e && e.code;
      throw err;
    }
    return data;
  }

  // ---------- komponen kecil ----------
  const badge = (level) => h('span', { class: `badge b-${String(level).toLowerCase()}`, text: level });
  const chips = (arr) => h('span', {}, (arr || []).map((m) => h('span', { class: 'chip', text: m })));
  const table = (heads, rows, opts = {}) => h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((r) => (Array.isArray(r) ? h('tr', {}, r.map((c) => h('td', {}, c))) : r)))));
  const card = (...kids) => h('div', { class: 'card' }, kids);
  const statBox = (label, value, cls) => h('div', { class: 'card soft' }, h('div', { class: 'small muted', text: label }), h('div', { class: `num ${cls || ''}`, text: value }));
  const errorCard = (err) => card(h('div', { class: 'note red', text: `Gagal memuat: ${err.message}` }));

  function setTab(id) { state.tab = id; renderTabs(); renderView(); }

  function tabsForRole() {
    const all = state.user.role === 'facility'
      ? [['skenario', 'Skenario Demo'], ['klaim', 'Kirim Klaim'], ['inspektur', 'Inspektur Data'], ['evaluasi', 'Hasil Evaluasi']]
      : [['skenario', 'Skenario Demo'], ['kasus', 'Antrean Verifikator'], ['inspektur', 'Inspektur Data'], ['evaluasi', 'Hasil Evaluasi'], ['audit', 'Audit & Kebijakan']];
    // Skenario & Inspektur hanya ada di DEMO_MODE (tidak tersedia di production).
    return all.filter(([id]) => state.config.demo_mode || !['skenario', 'inspektur'].includes(id));
  }
  const defaultTab = () => tabsForRole()[0][0];

  function renderHeader() {
    const ms = $('modeSwitch'); const ub = $('userBox'); const tabs = $('tabs');
    ms.replaceChildren(); ub.replaceChildren();
    if (!state.user) { ms.hidden = true; tabs.hidden = true; return; }
    if (state.config.allow_baseline) {
      ms.hidden = false;
      [['proposed', 'SAMAR aktif', ''], ['baseline', 'Tanpa SAMAR', 'warn']].forEach(([m, label, cls]) => {
        ms.append(h('button', { class: `${state.mode === m ? 'on' : ''} ${cls}`, text: label, onclick: () => { state.mode = m; sessionStorage.setItem('samar_mode', m); renderHeader(); renderView(); } }));
      });
    } else ms.hidden = true;
    ub.append(h('span', { class: 'small', text: `${state.user.name} · ${state.user.role === 'verifier' ? 'verifikator' : 'faskes'}  ` }), h('button', { class: 'btn sm alt', text: 'Keluar', onclick: () => { logout(); } }));
  }
  function renderTabs() {
    const t = $('tabs');
    t.replaceChildren();
    if (!state.user) { t.hidden = true; return; }
    t.hidden = false;
    for (const [id, label] of tabsForRole()) t.append(h('button', { class: state.tab === id ? 'on' : '', text: label, onclick: () => setTab(id) }));
  }
  function logout() {
    state.token = null; state.user = null; state.tab = null;
    sessionStorage.removeItem('samar_token'); sessionStorage.removeItem('samar_user');
    renderHeader(); renderTabs(); renderView();
  }

  function modeNote() {
    return state.mode === 'proposed'
      ? h('div', { class: 'note' }, h('b', { text: 'Mode SAMAR aktif: ' }), 'Privacy Service menyamarkan identitas dulu. Claim Service hanya menerima token, Fraud Service hanya menerima token lintas-faskes + atribut klinis.')
      : h('div', { class: 'note red' }, h('b', { text: 'Mode tanpa SAMAR (baseline): ' }), 'payload mentah (NIK, nama, telepon, no. RM) diteruskan apa adanya ke semua layanan - arsitektur konvensional sebagai pembanding.');
  }

  // ---------- LOGIN ----------
  async function viewLogin() {
    const root = h('div', { class: 'hero' });
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try { await doLogin(fd.get('username'), fd.get('password')); } catch (err) { toast(err.message, true); }
    } },
    h('h2', { text: 'Masuk' }),
    h('label', { class: 'f' }, 'Username', h('input', { name: 'username', required: true, autocomplete: 'username' })),
    h('label', { class: 'f' }, 'Password', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('p'), h('button', { class: 'btn', type: 'submit', text: 'Masuk' }));
    const demo = h('div');
    if (state.config.demo_mode) {
      try {
        const users = (await api('/api/auth/demo-users', { auth: false })).items;
        demo.append(h('h4', { text: 'Akun demo (satu klik)' }), h('div', { class: 'row' }, users.map((u) => h('button', { class: 'btn alt sm', text: `${u.name}`, onclick: () => doLogin(u.username, u.password).catch((err) => toast(err.message, true)) }))));
      } catch { /* abaikan */ }
    }
    form.append(h('p'), demo);
    const how = card(
      h('h2', { text: 'Samarkan identitas, perluas deteksi' }),
      h('p', { class: 'muted', text: 'Deteksi kecurangan klaim lintas rumah sakit butuh mencocokkan data pasien antar-faskes. SAMAR membuatnya mungkin tanpa membuka identitas pasien ke sistem analitik.' }),
      h('div', { class: 'flow' },
        h('div', { class: 'box', text: 'Faskes / SIMRS  →  API Gateway (JWT, validasi, rate-limit)' }), h('div', { class: 'arrow', text: '↓ data mentah masuk SEKALI' }),
        h('div', { class: 'box core', text: 'Privacy Service: kebijakan minimisasi + token dinamis + vault terenkripsi + audit' }), h('div', { class: 'arrow', text: '↓ hanya token & atribut yang dibutuhkan' }),
        h('div', { class: 'box', text: 'Claim · Fraud (aturan + Isolation Forest) · Notification' }), h('div', { class: 'arrow', text: '↓ kasus berisiko' }),
        h('div', { class: 'box', text: 'Verifikator (human-in-the-loop) → buka identitas hanya dengan alasan, kuota & audit' })),
      h('p', { class: 'small muted', text: `Data: sintetis saja (NIK berawalan 9999). Penyimpanan: ${state.config.store}.` }));
    root.append(form, how);
    return root;
  }
  async function doLogin(username, password) {
    const r = await api('/api/auth/login', { method: 'POST', body: { username, password }, auth: false });
    state.token = r.token; state.user = r.user;
    sessionStorage.setItem('samar_token', r.token); sessionStorage.setItem('samar_user', JSON.stringify(r.user));
    state.tab = defaultTab();
    renderHeader(); renderTabs(); renderView();
  }

  // ---------- SKENARIO ----------
  function stepView(s) {
    return h('div', { class: `step ${s.risk_level.toLowerCase()}` },
      h('div', { class: 'row' }, h('b', { text: s.step }), badge(s.risk_level), h('span', { class: 'small muted', text: `skor ${s.risk_score} · ${rp(s.amount)} · ${s.diagnosis_code} · ${s.length_of_stay} hari · ${s.admit_date}` }), s.case_id ? h('span', { class: 'chip', text: `masuk antrean: ${s.case_id.slice(0, 18)}…` }) : null),
      s.modi.length ? h('div', {}, chips(s.modi)) : null,
      s.reasons.length ? h('ul', { class: 'small' }, s.reasons.map((r) => h('li', { text: r }))) : h('div', { class: 'small muted', text: 'Tidak ada indikasi.' }));
  }
  async function viewSkenario() {
    const out = h('div');
    const grid = h('div', { class: 'grid g2' }, state.config.scenarios.map((sc) => {
      const btn = h('button', { class: 'btn sm', text: 'Jalankan', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Memproses...';
        try {
          const r = await api(`/api/demo/simulate/${sc.id}?mode=${state.mode}`, { method: 'POST' });
          out.replaceChildren(card(h('h3', { text: `${r.title}  ·  mode ${r.mode === 'proposed' ? 'SAMAR aktif' : 'baseline'}` }), r.steps.map(stepView)));
          out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) { toast(err.message, true); } finally { btn.disabled = false; btn.textContent = 'Jalankan'; }
      } });
      return h('div', { class: 'card scen' }, h('div', {}, h('b', { text: sc.title })), h('div', {}, btn));
    }));
    return h('div', {}, modeNote(), h('p'), h('h2', { text: 'Skenario Demo' }), h('p', { class: 'muted', text: 'Setiap skenario membuat pasien sintetis baru lalu mengirim klaim lewat pipeline yang sama dengan API sungguhan. Coba bergantian mode "SAMAR aktif" dan "Tanpa SAMAR": hasil deteksi sama, paparan data berbeda (lihat tab Inspektur Data).' }), grid, h('p'), out);
  }

  // ---------- KIRIM KLAIM ----------
  const FIRST = ['Budi', 'Siti', 'Agus', 'Dewi', 'Rina', 'Hendra', 'Wulan', 'Joko']; const LAST = ['Santoso', 'Wijaya', 'Pratama', 'Nugroho', 'Rahayu', 'Setiawan'];
  const rnd = (n) => Math.floor(Math.random() * n); const digits = (n) => Array.from({ length: n }, () => rnd(10)).join('');
  function sample(dx) {
    const d = new Date(); d.setDate(d.getDate() - 2);
    const info = state.config.diagnoses.find((x) => x.code === dx) || state.config.diagnoses[0];
    return {
      patient_nik: `9999${digits(12)}`, patient_name: `${FIRST[rnd(FIRST.length)]} ${LAST[rnd(LAST.length)]}`, phone: `08${digits(10)}`,
      birth_date: `${1950 + rnd(60)}-0${1 + rnd(9)}-1${rnd(9)}`, record_number: `RM-${digits(6)}`, diagnosis_code: info.code, procedure_code: info.procedures[0],
      claim_type: info.expected_los >= 2 ? 'RI' : 'RJ', admit_date: d.toISOString().slice(0, 10), length_of_stay: info.expected_los, amount: info.tariff_median,
    };
  }
  async function viewKlaim() {
    const result = h('div');
    const f = {}; // referensi input
    const field = (label, name, attrs = {}) => { f[name] = h(attrs.tag || 'input', { name, ...attrs.props }); return h('label', { class: 'f' }, label, f[name]); };
    const dxSel = h('select', { name: 'diagnosis_code' }, state.config.diagnoses.map((d) => h('option', { value: d.code, text: `${d.code} - ${d.name}` })));
    f.diagnosis_code = dxSel;
    const fill = (v) => { for (const [k, val] of Object.entries(v)) if (f[k]) f[k].value = val; };
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const body = {};
      for (const [k, el] of Object.entries(f)) { if (el.value === '') continue; body[k] = ['length_of_stay', 'amount'].includes(k) ? Number(el.value) : el.value; }
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const r = await api(`/api/claims?mode=${state.mode}`, { method: 'POST', body });
        result.replaceChildren(resultCard(r));
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
    } },
    h('h3', { text: 'Formulir klaim (data sintetis)' }),
    h('div', { class: 'grid g3' },
      field('NIK sintetis (16 digit, awalan 9999)', 'patient_nik', { props: { required: true, maxlength: 16, inputmode: 'numeric' } }),
      field('Nama pasien', 'patient_name', { props: { required: true } }),
      field('Telepon', 'phone', {}),
      field('Tanggal lahir', 'birth_date', { props: { type: 'date', required: true } }),
      field('No. rekam medis', 'record_number', { props: { required: true } }),
      h('label', { class: 'f' }, 'Diagnosis (ICD-10)', dxSel),
      field('Kode tindakan (ICD-9-CM)', 'procedure_code', {}),
      h('label', { class: 'f' }, 'Jenis', (f.claim_type = h('select', { name: 'claim_type' }, h('option', { value: 'RI', text: 'Rawat inap' }), h('option', { value: 'RJ', text: 'Rawat jalan' })))),
      field('Tanggal masuk', 'admit_date', { props: { type: 'date', required: true } }),
      field('Lama rawat (hari)', 'length_of_stay', { props: { type: 'number', min: 1, max: 365, required: true } }),
      field('Nominal klaim (Rp)', 'amount', { props: { type: 'number', min: 1, required: true } })),
    h('p'), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', text: 'Kirim klaim' }), h('button', { class: 'btn alt', type: 'button', text: 'Isi contoh sintetis', onclick: () => fill(sample(dxSel.value)) })));
    fill(sample('J18.9'));
    return h('div', {}, modeNote(), h('p'), form, result);
  }
  function resultCard(r) {
    const lvl = r.fraud.risk_level.toLowerCase();
    return card(
      h('div', { class: 'row' }, h('h3', { text: `Klaim ${r.claim_id}` }), badge(r.fraud.risk_level), h('span', { class: 'small muted', text: `skor risiko ${r.fraud.risk_score}/100 · skor anomali ML ${r.fraud.ml_score}` })),
      h('div', { class: `bar ${lvl}` }, barFill(r.fraud.risk_score)),
      r.fraud.flags.length ? r.fraud.flags.map((f) => h('div', { class: `step ${lvl}` }, h('b', { text: f.modus }), ` (${f.rule}, skor ${f.score})`, h('div', { class: 'small', text: f.reason }))) : h('p', { class: 'muted', text: 'Tidak ada indikasi kecurangan.' }),
      r.fraud.case_id ? h('div', { class: 'note' }, `Kasus ${r.fraud.case_id} masuk antrean verifikator.`) : null,
      h('p', { class: 'small muted', text: `Waktu: total ${r.timings.total_ms} ms (privasi ${r.timings.privacy_ms ?? 0} · klaim ${r.timings.claims_ms} · fraud ${r.timings.fraud_ms})` }),
      r.visibility ? h('div', { class: 'grid g2' }, h('div', {}, h('h4', { text: 'Diterima Claim Service' }), kvPii(r.visibility.claims_received)), h('div', {}, h('h4', { text: 'Diterima Fraud Service' }), kvPii(r.visibility.fraud_received))) : null);
  }
  function barFill(score) { const i = h('i'); i.style.width = `${Math.max(2, Math.min(100, score))}%`; return i; } // CSSOM: diizinkan CSP (atribut style inline tidak)
  function isPii(k, v) { return PII_KEYS.has(k) || RE_NIK.test(String(v)); }
  function kvPii(obj) {
    const box = h('div', { class: 'kv' });
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') continue;
      const pii = isPii(k, v);
      box.append(h('div', { class: 'k', text: k }), h('div', { class: `v mono${pii ? ' pii' : ''}`, text: `${v}${pii ? '   ⚠ PII asli' : ''}` }));
    }
    return box;
  }

  // ---------- INSPEKTUR ----------
  async function viewInspektur() {
    const root = h('div');
    const body = h('div');
    let svc = 'fraud';
    const names = { claims: 'Claim Processing', fraud: 'Fraud Detection', notify: 'Notification' };
    const seg = h('div', { class: 'row' });
    async function load() {
      seg.replaceChildren(...Object.entries(names).map(([k, n]) => h('button', { class: `btn sm ${svc === k ? '' : 'alt'}`, text: n, onclick: () => { svc = k; load(); } })), h('button', { class: 'btn sm danger', text: 'Bersihkan rekaman', onclick: async () => { await api('/api/demo/tap', { method: 'DELETE' }); load(); } }));
      body.replaceChildren(h('p', { class: 'muted', text: 'Memuat...' }));
      try {
        const items = (await api(`/api/demo/tap/${svc}`)).items;
        const withPii = items.filter((it) => Object.entries(it.body).some(([k, v]) => v && typeof v !== 'object' && isPii(k, v))).length;
        body.replaceChildren(
          h('div', { class: 'grid g3' }, statBox('Payload terekam', items.length), statBox('Mengandung PII asli', withPii, withPii ? 'bad' : 'good'), statBox('Bersih dari PII', items.length - withPii, 'good')),
          h('p'), items.length === 0 ? h('div', { class: 'note', text: 'Belum ada payload. Jalankan skenario atau kirim klaim dulu, lalu kembali ke sini.' }) : items.slice(0, 8).map((it) => card(h('div', { class: 'small muted', text: `${fmtTime(it.ts)}  ·  POST ${it.path}` }), kvPii(it.body))));
      } catch (err) { body.replaceChildren(errorCard(err)); }
    }
    root.append(modeNote(), h('p'), h('h2', { text: 'Inspektur Data: apa yang benar-benar diterima tiap layanan?' }), h('p', { class: 'muted', text: 'Rekaman ini diambil oleh masing-masing layanan sendiri (bukan laporan Gateway), jadi merupakan bukti independen paparan data pribadi.' }), seg, h('p'), body);
    await load();
    try {
      const pol = await api('/api/policy');
      root.append(h('h3', { text: `Kebijakan minimisasi (versi ${pol.version})` }), card(table(['Layanan', 'Field yang boleh diterima', 'Tujuan token'], Object.entries(pol.services).map(([s, v]) => [s, Object.entries(v.fields).map(([f, r]) => h('span', { class: `chip${r.op === 'pass' ? '' : ''}`, text: r.op === 'pass' ? f : `${f} (${r.op})` })), v.allowed_purposes.join(', ')])), h('p', { class: 'small muted', text: 'Default-deny: field yang tidak tercantum (nama, telepon, NIK, tanggal lahir) tidak pernah diteruskan.' })));
    } catch { /* abaikan */ }
    return root;
  }

  // ---------- KASUS (verifikator) ----------
  async function viewKasus() {
    const root = h('div'); const detail = h('div');
    const list = h('div');
    async function loadList() {
      list.replaceChildren(h('p', { class: 'muted', text: 'Memuat...' }));
      try {
        const items = (await api('/api/cases')).items;
        list.replaceChildren(items.length === 0 ? h('div', { class: 'note', text: 'Belum ada kasus. Jalankan skenario di tab Skenario Demo.' }) : table(['Kasus', 'Risiko', 'Modus', 'Faskes', 'Diagnosis', 'Nominal', 'Status', 'Waktu'], items.map((c) => h('tr', { class: `click${state.selectedCase === c.case_id ? ' sel' : ''}`, onclick: () => { state.selectedCase = c.case_id; loadList(); showCase(c.case_id); } },
          [h('td', { class: 'mono small', text: c.case_id.replace('CASE-CLM-', '#') }), h('td', {}, badge(c.risk_level), ` ${c.risk_score}`), h('td', {}, chips(c.modi)), h('td', { text: c.facility_id }), h('td', { text: c.diagnosis_code }), h('td', { text: rp(c.amount) }), h('td', { text: c.status }), h('td', { class: 'small', text: fmtTime(c.created_ms) })]))));
      } catch (err) { list.replaceChildren(errorCard(err)); }
    }
    async function showCase(id) {
      detail.replaceChildren(h('p', { class: 'muted', text: 'Memuat kasus...' }));
      try {
        const c = await api(`/api/cases/${encodeURIComponent(id)}`);
        const decision = h('select', {}, h('option', { value: 'CONFIRMED_FRAUD', text: 'Terkonfirmasi kecurangan' }), h('option', { value: 'DISMISSED_FALSE_POSITIVE', text: 'Bukan kecurangan (false positive)' }), h('option', { value: 'NEEDS_MORE_INFO', text: 'Perlu informasi tambahan' }));
        const note = h('textarea', { placeholder: 'Catatan peninjauan (wajib)' });
        const just = h('textarea', { placeholder: 'Alasan membuka identitas, min. 20 karakter (mis. nomor surat tugas / kebutuhan verifikasi dokumen)' });
        const revealOut = h('div');
        detail.replaceChildren(card(
          h('div', { class: 'row' }, h('h3', { text: `Kasus ${c.case_id}` }), badge(c.risk_level), h('span', { class: 'chip', text: c.status })),
          h('p', { class: 'small muted', text: `${c.facility_id} · ${c.diagnosis_code} · ${rp(c.amount)} · masuk ${c.admit_date} · token pasien ${c.fraud_ref.slice(0, 16)}…` }),
          h('h4', { text: 'Mengapa ditandai (dapat dijelaskan)' }),
          c.flags.map((f) => h('div', { class: `step ${f.score >= 70 ? 'high' : 'medium'}` }, h('b', { text: f.modus }), ` · ${f.rule} · skor ${f.score}`, h('div', { class: 'small', text: f.reason }), h('details', {}, h('summary', { text: 'bukti' }), h('pre', { text: JSON.stringify(f.evidence, null, 2) })))),
          c.reviews.length ? [h('h4', { text: 'Riwayat peninjauan' }), c.reviews.map((r) => h('div', { class: 'small', text: `${fmtTime(r.ts_ms)} · ${r.reviewer} · ${r.decision} · ${r.note}` }))] : null,
          h('div', { class: 'grid g2' },
            h('div', { class: 'card soft' }, h('h4', { text: 'Keputusan peninjau (human-in-the-loop)' }), h('p', { class: 'small muted', text: 'Sistem hanya memberi sinyal. Keputusan akhir ada pada verifikator.' }), decision, h('p'), note, h('p'),
              h('button', { class: 'btn', text: 'Simpan keputusan', onclick: async () => {
                try { await api(`/api/cases/${encodeURIComponent(id)}/review`, { method: 'POST', body: { decision: decision.value, note: note.value } }); toast('Keputusan tersimpan'); loadList(); showCase(id); } catch (err) { toast(err.message, true); }
              } })),
            h('div', { class: 'card soft' }, h('h4', { text: 'Buka identitas pasien' }), h('p', { class: 'small muted', text: 'Hanya untuk keperluan investigasi. Dibatasi peran, kuota per jam, dan setiap percobaan dicatat di audit log.' }), just, h('p'),
              h('button', { class: 'btn danger', text: 'Buka identitas (teraudit)', onclick: async () => {
                try {
                  const r = await api(`/api/cases/${encodeURIComponent(id)}/reveal`, { method: 'POST', body: { justification: just.value } });
                  revealOut.replaceChildren(h('div', { class: r.protected ? 'note' : 'note red' }, h('b', { text: `NIK: ${r.patient_nik}` }), h('div', { class: 'small', text: r.note })));
                } catch (err) { revealOut.replaceChildren(h('div', { class: 'note red', text: `Ditolak: ${err.message}` })); }
              } }), h('p'), revealOut))));
      } catch (err) { detail.replaceChildren(errorCard(err)); }
    }
    root.append(h('h2', { text: 'Antrean Verifikator' }), card(list), detail);
    await loadList();
    if (state.selectedCase) showCase(state.selectedCase);
    return root;
  }

  // ---------- EVALUASI ----------
  async function viewEvaluasi() {
    const root = h('div', {}, h('h2', { text: 'Hasil Evaluasi Terukur' }));
    let r;
    try { r = await api('/api/evaluation/latest'); } catch (err) {
      root.append(card(h('div', { class: 'note', text: err.status === 404 ? 'Belum ada laporan. Jalankan di terminal:  npm run evaluate  (±1 menit), lalu muat ulang halaman ini.' : err.message })));
      return root;
    }
    const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);
    root.append(h('p', { class: 'muted', text: `Dibuat ${new Date(r.generated_at).toLocaleString('id-ID')} · ${r.dataset.claims} klaim sintetis (${r.dataset.fraud_labeled} berlabel fraud) · Node ${r.node} · ${r.platform}` }), h('div', { class: 'note', text: r.dataset.note }));
    const d = r.detection;
    root.append(h('div', { class: 'grid g4' },
      statBox('Paritas deteksi baseline = proposed', `${d.parity.pct.toFixed(1)}%`, d.parity.pct === 100 ? 'good' : 'bad'),
      statBox('Paparan PII ke layanan hilir (baseline → SAMAR)', `${(r.privacy.baseline.pct_with_pii).toFixed(0)}% → ${(r.privacy.proposed.pct_with_pii).toFixed(0)}%`, 'good'),
      statBox('Penolakan akses tidak sah', `${r.security.rejected_pct.toFixed(1)}%`, r.security.rejected_pct === 100 ? 'good' : 'bad'),
      statBox('Overhead latensi p95', `+${r.performance.overhead.p95_abs_ms} ms (${r.performance.overhead.p95_pct >= 0 ? '+' : ''}${r.performance.overhead.p95_pct.toFixed(0)}%)`)));
    root.append(h('p'), card(h('h3', { text: '1. Efektivitas deteksi (privasi naik, deteksi tidak turun)' }),
      table(['Mode', 'Precision', 'Recall', 'F1', 'TP', 'FP', 'FN', 'TN', 'AUC ML saja'], ['baseline', 'proposed'].map((m) => [m === 'proposed' ? 'SAMAR aktif' : 'Tanpa SAMAR', pct(d[m].precision), pct(d[m].recall), pct(d[m].f1), d[m].tp, d[m].fp, d[m].fn, d[m].tn, d[m].ml_only_auc == null ? '-' : d[m].ml_only_auc.toFixed(3)])),
      h('p'), h('h4', { text: 'Recall per modus (SAMAR aktif)' }),
      table(['Modus', 'Klaim fraud', 'Terdeteksi', 'Recall'], d.proposed.per_modus.map((x) => [x.modus, x.n, x.hit, pct(x.recall)])),
      h('p', { class: 'small muted', text: `Paritas: ${d.parity.identical} dari ${d.parity.total} klaim menghasilkan skor & modus identik di kedua mode.` })));
    const priv = r.privacy;
    root.append(card(h('h3', { text: '2. Paparan data pribadi per layanan (diukur dari payload yang benar-benar diterima)' }),
      table(['Layanan', 'Payload (baseline)', 'Mengandung PII', 'Payload (SAMAR)', 'Mengandung PII', 'Kategori PII (baseline)'],
        Object.keys(priv.baseline.services).map((s) => { const a = priv.baseline.services[s]; const b = priv.proposed.services[s]; return [s, a.payloads, `${a.with_pii} (${a.payloads ? Math.round((a.with_pii / a.payloads) * 100) : 0}%)`, b.payloads, `${b.with_pii} (${b.payloads ? Math.round((b.with_pii / b.payloads) * 100) : 0}%)`, Object.keys(a.categories).join(', ') || '-']; })),
      h('p', { class: 'small muted', text: priv.note })));
    const p = r.performance;
    root.append(card(h('h3', { text: '3. Kinerja (overhead lapisan SAMAR)' }),
      table(['Mode', 'Permintaan', 'Rata-rata', 'p50', 'p95', 'p99', 'Throughput', 'Error'], ['baseline', 'proposed'].map((m) => [m === 'proposed' ? 'SAMAR aktif' : 'Tanpa SAMAR', p[m].n, `${p[m].mean_ms} ms`, `${p[m].p50_ms} ms`, `${p[m].p95_ms} ms`, `${p[m].p99_ms} ms`, `${p[m].tps} TPS`, p[m].errors])),
      h('p', { class: 'small muted', text: `Overhead: rata-rata ${p.overhead.mean_pct.toFixed(1)}% · p50 ${p.overhead.p50_pct.toFixed(1)}% (+${p.overhead.p50_abs_ms} ms) · p95 ${p.overhead.p95_pct.toFixed(1)}% (+${p.overhead.p95_abs_ms} ms) · throughput ${p.overhead.tps_pct.toFixed(1)}%. ${p.note}` })));
    root.append(card(h('h3', { text: `4. Keamanan: ${r.security.rejected}/${r.security.total} percobaan tidak sah ditolak` }),
      table(['Skenario', 'Diharapkan', 'Hasil', ''], r.security.tests.map((t) => [t.name, t.expected, t.got, h('span', { class: `badge ${t.pass ? 'b-ok' : 'b-bad'}`, text: t.pass ? 'LULUS' : 'GAGAL' })]))));
    root.append(card(h('h3', { text: `5. Fungsional: ${r.functional.passed}/${r.functional.total} lulus` }), table(['Uji', ''], r.functional.tests.map((t) => [t.name, h('span', { class: `badge ${t.pass ? 'b-ok' : 'b-bad'}`, text: t.pass ? 'LULUS' : 'GAGAL' })]))));
    return root;
  }

  // ---------- AUDIT & KEBIJAKAN ----------
  async function viewAudit() {
    const root = h('div', {}, h('h2', { text: 'Audit & Tata Kelola' }));
    try {
      const [stats, audit] = await Promise.all([api('/api/stats'), api('/api/audit?limit=60')]);
      const pr = stats.privacy;
      root.append(h('div', { class: 'grid g4' }, statBox('Token aktif', pr.tokens_active), statBox('Token dicabut', pr.tokens_revoked), statBox('Re-identifikasi berhasil', pr.reidentify_success), statBox('Re-identifikasi ditolak', pr.reidentify_denied, pr.reidentify_denied ? 'bad' : '')));
      root.append(h('p'), card(h('h3', { text: 'Log audit Privacy Service (tidak memuat NIK mentah)' }),
        table(['Waktu', 'Aksi', 'Status', 'Layanan', 'Tujuan', 'Aktor', 'Kasus', 'Alasan'], audit.items.map((a) => [h('span', { class: 'small', text: fmtTime(a.ts_ms) }), a.action, h('span', { class: `badge ${a.status === 'SUCCESS' ? 'b-ok' : 'b-bad'}`, text: a.status }), a.requesting_service, a.purpose || '-', a.actor ? `${a.actor}${a.actor_role ? ` (${a.actor_role})` : ''}` : '-', a.case_id ? a.case_id.slice(0, 16) : '-', a.reason || '-']))));
      const nik = h('input', { placeholder: 'NIK sintetis 16 digit', maxlength: 16 });
      root.append(card(h('h3', { text: 'Hak subjek data (UU PDP): cabut kemampuan re-identifikasi' }), h('p', { class: 'small muted', text: 'Menghapus vault identitas (crypto-shredding). Token tetap ada tetapi tidak akan pernah bisa dibuka lagi.' }),
        h('div', { class: 'row' }, nik, h('button', { class: 'btn danger sm', text: 'Cabut', onclick: async () => { try { const r = await api('/api/subjects/revoke', { method: 'POST', body: { patient_nik: nik.value } }); toast(`${r.revoked} token dicabut`); viewAndMount('audit'); } catch (err) { toast(err.message, true); } } }))));
    } catch (err) { root.append(errorCard(err)); }
    return root;
  }
  function viewAndMount(tab) { state.tab = tab; renderView(); }

  async function viewKlaimOrDefault() { return state.user.role === 'facility' ? viewKlaim() : viewKasus(); }

  // ---------- router ----------
  async function renderView() {
    const v = $('view');
    v.replaceChildren(h('p', { class: 'muted', text: 'Memuat...' }));
    try {
      let el;
      if (!state.user) el = await viewLogin();
      else if (state.tab === 'klaim') el = await viewKlaim();
      else if (state.tab === 'inspektur') el = await viewInspektur();
      else if (state.tab === 'kasus') el = await viewKasus();
      else if (state.tab === 'evaluasi') el = await viewEvaluasi();
      else if (state.tab === 'audit') el = await viewAudit();
      else if (state.tab === 'skenario') el = await viewSkenario();
      else el = await viewKlaimOrDefault();
      v.replaceChildren(el);
    } catch (err) { v.replaceChildren(errorCard(err)); }
  }

  async function init() {
    try { state.config = await api('/api/config', { auth: false }); } catch (err) {
      $('view').replaceChildren(card(h('div', { class: 'note red', text: `Tidak dapat menghubungi server: ${err.message}` }))); return;
    }
    if (state.user && !state.tab) state.tab = defaultTab();
    renderHeader(); renderTabs(); renderView();
  }
  init();
})();
