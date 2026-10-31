// Pustaka kecil bersama untuk semua tampilan. Semua data dari API dimasukkan lewat textContent (tanpa innerHTML).
export const $ = (id) => document.getElementById(id);
export const state = { token: null, user: null, config: null };
try { const s = JSON.parse(sessionStorage.getItem('samar') || 'null'); if (s) Object.assign(state, s); } catch { /* sessionStorage tidak tersedia */ }
export const save = () => { try { sessionStorage.setItem('samar', JSON.stringify({ token: state.token, user: state.user })); } catch { /* abaikan */ } };

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== undefined && v !== false && v !== null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
// Angka besar dibaca sebagai "juta", "miliar", atau "triliun" agar tidak terpotong dan mudah dibandingkan.
export const rpShort = (n) => {
  const v = Number(n) || 0; const a = Math.abs(v);
  const f = (x, u) => `Rp${x.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${u}`;
  if (a >= 1e12) return f(v / 1e12, 'triliun');
  if (a >= 1e9) return f(v / 1e9, 'miliar');
  if (a >= 1e6) return f(v / 1e6, 'juta');
  return rp(v);
};
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const pct = (x, d = 1) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(d)}%`);
export const ago = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m} menit` : m < 1440 ? `${Math.round(m / 60)} jam` : `${Math.round(m / 1440)} hari`; };

const RISK_ICON = { HIGH: '▲', MEDIUM: '◆', LOW: '●' };
export const RISK_LABEL = { HIGH: 'Tinggi', MEDIUM: 'Sedang', LOW: 'Rendah' };
export const badge = (lvl) => h('span', { class: `badge ${lvl}` }, RISK_ICON[lvl] ?? '', ' ', RISK_LABEL[lvl] ?? lvl);

// MODUS = pola kecurangan yang ditandai aturan (self-referral, cloning, dst.). SINYAL = asal isyarat: aturan, ML anomali, ML supervised.
export const MODUS_LABEL = {
  SELF_REFERRAL: 'Self-referral', PHANTOM_BILLING: 'Phantom billing', CLONING: 'Cloning', UPCODING: 'Upcoding', UNBUNDLING: 'Unbundling',
  REPEAT_BILLING: 'Repeat billing', PROLONGED_LOS: 'Prolonged LOS', PROCEDURE_MISMATCH: 'Prosedur tidak sesuai', ML_ANOMALY: 'ML anomali', ML_SUPERVISED: 'ML supervised',
};
export const labelOf = (k) => RISK_LABEL[k] ?? MODUS_LABEL[k] ?? String(k).replaceAll('_', ' ');
const ML_MODI = ['ML_ANOMALY', 'ML_SUPERVISED'];
export const modusOf = (c) => (c.modi ?? []).filter((m) => !ML_MODI.includes(m));
export const modusCell = (c) => { const m = modusOf(c); return m.length ? m.map(labelOf).join(', ') : '-'; };
export const sinyalCell = (c) => {
  const modi = c.modi ?? [];
  const tags = [modusOf(c).length ? 'Aturan' : null, modi.includes('ML_ANOMALY') ? 'ML anomali' : null, modi.includes('ML_SUPERVISED') ? 'ML supervised' : null].filter(Boolean);
  return h('span', { class: 'tags' }, tags.length ? tags.map((t) => h('span', { class: 'tag' }, t)) : '-');
};
export const SUMBER_LABEL = { llm: 'AI', template: 'Templat' };
export const sumberBadge = (src) => h('span', { class: `badge status sumber-${src ?? 'none'}`, title: src === 'llm' ? 'Penjelasan ditulis model AI dari data tanpa identitas' : 'Penjelasan dari templat aturan' }, SUMBER_LABEL[src] ?? '-');
export const statusBadge = (s) => h('span', { class: `badge status ${s}` }, String(s).replaceAll('_', ' '));

// Penjelasan rumus "potensi nilai dipertanyakan" per modus. Ini estimasi dari aturan, bukan kerugian terkonfirmasi.
export const MODUS_RUMUS = {
  REPEAT_BILLING: 'Klaim ganda: nilai = tagihan klaim kedua.',
  UPCODING: 'Upcoding: nilai = selisih tagihan terhadap median tarif INA-CBGs kelompok diagnosis yang sama (referensi sintetis).',
  PROLONGED_LOS: 'Lama rawat berlebih: nilai = porsi tagihan untuk hari di atas rata-rata lama rawat diagnosis.',
  PHANTOM_BILLING: 'Klaim hantu (rawat tumpang tindih): nilai = tagihan klaim yang tumpang tindih.',
  CLONING: 'Cloning (klaim identik): nilai = tagihan klaim yang identik.',
  UNBUNDLING: 'Unbundling: tidak dihitung (0). Sinyal ini hanya memberi prioritas review.',
  SELF_REFERRAL: 'Rujukan semu lintas faskes: tidak dihitung (0). Sinyal ini hanya memberi prioritas review.',
  ML_ANOMALY: 'Anomali statistik: tidak dihitung (0). Sinyal ini hanya memberi prioritas review.',
  ML_SUPERVISED: 'Model supervised: tidak dihitung (0). Sinyal ini hanya memberi prioritas review.',
};
export const NILAI_LABEL = 'Potensi nilai dipertanyakan (estimasi)';
export const NILAI_TIP = 'Estimasi nilai klaim yang tampak tidak wajar menurut aturan deteksi. Bukan kerugian: baru menjadi kerugian jika kasus terkonfirmasi dan klaim ditahan atau ditagih kembali. Rumus per modus ada di detail kasus.';
export const info = (tip) => h('button', { type: 'button', class: 'info', 'data-tip': tip, 'aria-label': tip }, 'i');

export async function api(path, { method = 'GET', body, raw, type = 'application/json' } = {}) {
  const res = await fetch(`/api/v1${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': type } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) }, body: body === undefined ? undefined : (type === 'application/json' ? JSON.stringify(body) : body) });
  if (res.status === 401 && state.token) { document.dispatchEvent(new CustomEvent('samar:logout', { detail: 'Sesi berakhir, silakan masuk lagi.' })); throw new Error('Sesi berakhir'); }
  if (raw) { if (!res.ok) throw new Error(`Gagal (${res.status})`); return res; }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Gagal (${res.status})`);
  return json;
}
export async function download(path, name) {
  const blob = await (await api(path, { raw: true })).blob();
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}
export const note = (el, text, kind = 'err') => { const k = kind === true ? 'ok' : kind === false ? 'err' : kind; el.replaceChildren(h('div', { class: `msg ${k}`, role: k === 'err' ? 'alert' : 'status' }, text)); };
export const loading = (el, text = 'Memuat...') => el.replaceChildren(h('p', { class: 'muted', role: 'status' }, text));
export const table = (head, rows, { caption, num = [] } = {}) => h('div', { class: 'table-wrap' }, h('table', {}, caption ? h('caption', {}, caption) : null,
  h('thead', {}, h('tr', {}, head.map((x, i) => h('th', { scope: 'col', class: num.includes(i) ? 'num' : '' }, x)))),
  h('tbody', {}, rows.map((r) => h('tr', r.attrs ?? {}, (r.cells ?? r).map((c, i) => h('td', { class: num.includes(i) ? 'num' : '' }, c)))))));
export const navigate = (hash) => { location.hash = hash; };
