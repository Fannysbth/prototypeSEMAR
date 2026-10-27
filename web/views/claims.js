// Daftar klaim ter-token: pratinjau seperti sistem nyata. Token sebagian, tanpa nama atau NIK.
import { $, h, api, state, note, table, badge, statusBadge, rp, navigate, loading } from '../lib.js';

const STATUS = ['TANPA_KASUS', 'BARU', 'DITINJAU', 'BUTUH_INFO', 'MENUNGGU_FASKES', 'ESKALASI', 'TERKONFIRMASI', 'DITOLAK_FALSE_POSITIVE', 'SELESAI'];

export async function viewKlaim() {
  const f = { q: '', facility: '', diagnosis: '', status: '', min_score: '' };
  const out = h('div', { 'aria-live': 'polite' });
  const field = (key, label, el) => { el.id = `f-${key}`; el.addEventListener('change', () => { f[key] = el.value; }); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { f[key] = el.value; load(); } }); return h('div', {}, h('label', { for: el.id }, label), el); };
  const select = (opts) => h('select', {}, h('option', { value: '' }, 'Semua'), opts.map(([v, t]) => h('option', { value: v }, t ?? v)));
  async function load() {
    loading(out);
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString();
    try {
      const r = await api(`/claims/tokenized${q ? `?${q}` : ''}`);
      out.replaceChildren(h('p', { class: 'muted' }, `Menampilkan ${r.items.length} dari ${r.total} klaim.`),
        r.items.length ? table(['Nomor klaim', 'Token pasien', 'Faskes', 'Tanggal masuk', 'Diagnosis', 'Tarif', 'Skor', 'Risiko', 'Status'],
          r.items.map((c) => [c.case_id ? h('button', { class: 'link', type: 'button', onclick: () => navigate(`#kasus/${c.case_id}`) }, c.claim_id) : c.claim_id, h('span', { class: 'mono' }, c.token), c.facility_id, c.admit_date, c.diagnosis_code, rp(c.amount), c.score, c.risk_level === 'NONE' ? '-' : badge(c.risk_level), statusBadge(c.status)]), { num: [5, 6] })
          : h('p', { class: 'muted' }, 'Tidak ada klaim yang cocok dengan filter.'));
    } catch (e) { note(out, e.message); }
  }
  const facilities = (state.config?.facilities ?? []).map((x) => [x.id]);
  $('view').replaceChildren(h('h1', {}, 'Klaim ter-token'),
    h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Tampilan data seperti yang diterima zona analitik: identitas sudah diganti token. Skor 0 berarti tidak ada sinyal.'),
      h('form', { onsubmit: (e) => { e.preventDefault(); load(); } },
        h('div', { class: 'row' }, field('q', 'Cari nomor klaim atau token', h('input', { type: 'search', placeholder: 'mis. FKL-NOV-0039' })), field('facility', 'Faskes', select(facilities)), field('diagnosis', 'Diagnosis (ICD-10)', h('input', { placeholder: 'mis. N39.0' })),
          field('status', 'Status kasus', select(STATUS.map((s) => [s, s.replaceAll('_', ' ')]))), field('min_score', 'Skor minimal', h('input', { type: 'number', min: '0', max: '100' })),
          h('div', {}, h('button', { class: 'btn', type: 'submit' }, 'Terapkan filter')))), out));
  load();
}
