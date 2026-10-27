// Frontend tipis SAMAR: login, rute hash per peran, beranda, unggah, klaim ter-token, kasus, berkas, dashboard, evaluasi, audit.
// Tiap tampilan ada di web/views/. Semua data dari API dimasukkan lewat textContent (tanpa innerHTML).
import { $, h, api, state, save, note } from './lib.js';
import { viewBeranda } from './views/home.js';
import { viewUnggah } from './views/upload.js';
import { viewKlaim } from './views/claims.js';
import { viewKasus } from './views/cases.js';
import { viewBerkas } from './views/files.js';
import { viewDashboard } from './views/dashboard.js';
import { viewEvaluasi } from './views/evaluasi.js';
import { viewAudit } from './views/audit.js';

const VIEWS = { beranda: viewBeranda, unggah: viewUnggah, klaim: viewKlaim, kasus: viewKasus, berkas: viewBerkas, dashboard: viewDashboard, evaluasi: viewEvaluasi, audit: viewAudit };
const TABS = {
  facility: [['beranda', 'Beranda'], ['unggah', 'Unggah CSV'], ['berkas', 'Permintaan berkas']],
  verifier: [['beranda', 'Beranda'], ['kasus', 'Kasus'], ['klaim', 'Klaim'], ['unggah', 'Unggah CSV'], ['dashboard', 'Dashboard']],
  auditor: [['beranda', 'Beranda'], ['kasus', 'Kasus'], ['klaim', 'Klaim'], ['dashboard', 'Dashboard & simulasi'], ['evaluasi', 'Evaluasi']],
  admin: [['beranda', 'Beranda'], ['klaim', 'Klaim'], ['dashboard', 'Dashboard & simulasi'], ['audit', 'Audit & pengaturan'], ['evaluasi', 'Evaluasi']],
};
const ROLE_LABEL = { facility: 'Faskes', verifier: 'Verifikator', auditor: 'Auditor', admin: 'Admin / DPO' };
const route = () => { const [tab, ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/'); return { tab: tab || 'beranda', arg: rest.join('/') || undefined }; };

function logout(msg) { state.token = null; state.user = null; save(); location.hash = ''; render(msg); }
document.addEventListener('samar:logout', (e) => logout(e.detail));

function renderHeader(tab) {
  const top = $('top');
  const bar = h('div', { class: 'bar' }, h('span', { class: 'brand' }, 'SAMAR'));
  if (state.user) {
    bar.append(h('nav', { 'aria-label': 'Menu utama' }, TABS[state.user.role].map(([id, label]) => h('button', { type: 'button', 'aria-current': tab === id ? 'page' : undefined, onclick: () => { location.hash = `#${id}`; } }, label))),
      h('div', { class: 'who' }, h('span', { class: 'muted' }, `${state.user.name} (${ROLE_LABEL[state.user.role]})`), h('a', { class: 'btn alt', href: '/docs', target: '_blank', rel: 'noopener' }, 'API /docs'), h('button', { class: 'btn alt', type: 'button', onclick: () => logout() }, 'Keluar')));
  }
  top.replaceChildren(bar);
}

async function viewLogin(msg) {
  const out = h('div', { 'aria-live': 'polite' }); if (msg) note(out, msg);
  const u = h('input', { id: 'u', autocomplete: 'username' }); const p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password' });
  const submit = async (username, password) => {
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password } });
      state.token = r.token; state.user = r.user; save(); location.hash = '#beranda'; render();
    } catch (e) { note(out, e.message); }
  };
  const demo = h('div');
  try {
    state.config = await (await fetch('/api/config')).json();
    if (state.config.demo_mode) {
      const { items } = await (await fetch('/api/v1/auth/demo-users')).json();
      demo.append(h('h2', {}, 'Akun demo (data sintetis)'), h('div', { class: 'actions' }, items.filter((x) => x.role !== 'facility' || x.facility_id === 'RS-A').map((x) => h('button', { class: 'btn alt', type: 'button', onclick: () => submit(x.username, x.password) }, `${ROLE_LABEL[x.role]}: ${x.username}`))));
    }
  } catch { /* demo tidak tersedia */ }
  $('view').replaceChildren(h('h1', {}, 'Masuk ke SAMAR'), h('div', { class: 'card' },
    h('form', { onsubmit: (e) => { e.preventDefault(); submit(u.value, p.value); } },
      h('div', { class: 'row' }, h('div', {}, h('label', { for: 'u' }, 'Nama pengguna'), u), h('div', {}, h('label', { for: 'p' }, 'Kata sandi'), p), h('div', {}, h('button', { class: 'btn', type: 'submit' }, 'Masuk'))), out), demo));
}

async function render(msg) {
  const { tab: wanted, arg } = route();
  if (!state.user) { renderHeader(null); return viewLogin(msg); }
  if (!state.config) state.config = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  const tab = TABS[state.user.role].some(([id]) => id === wanted) ? wanted : 'beranda';
  renderHeader(tab);
  document.title = `${TABS[state.user.role].find(([id]) => id === tab)[1]} - SAMAR`;
  return VIEWS[tab](tab === wanted ? arg : undefined);
}
window.addEventListener('hashchange', () => render());
render();
