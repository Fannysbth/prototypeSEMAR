// Kasus: daftar dan detail. Verifikator menilai dari pola token; bila butuh bukti ia meminta berkas ke faskes, bila butuh identitas ia
// mengeskalasi ke auditor. Hanya auditor yang punya aksi buka identitas.
import { timeline } from './timeline.js';
import { $, h, api, state, note, table, badge, statusBadge, modusCell, sinyalCell, sumberBadge, labelOf, rp, fmtTime, ago, navigate, loading, download, info, MODUS_RUMUS, NILAI_LABEL, NILAI_TIP } from '../lib.js';

export const STATUSES = ['BARU', 'DITINJAU', 'BUTUH_INFO', 'MENUNGGU_FASKES', 'ESKALASI', 'TERKONFIRMASI', 'DITOLAK_FALSE_POSITIVE', 'SELESAI'];
const MODI = ['SELF_REFERRAL', 'PHANTOM_BILLING', 'CLONING', 'UPCODING', 'UNBUNDLING', 'REPEAT_BILLING', 'PROLONGED_LOS', 'ML_ANOMALY', 'ML_SUPERVISED'];

async function viewDaftar() {
  const f = { risk: '', status: '', modus: '', faskes: '' };
  const list = h('div', { 'aria-live': 'polite' });
  const sel = (key, label, opts) => { const el = h('select', { id: `c-${key}`, onchange: (e) => { f[key] = e.target.value; load(); } }, h('option', { value: '' }, 'Semua'), opts.map((o) => h('option', { value: o }, labelOf(o)))); return h('div', {}, h('label', { for: `c-${key}` }, label), el); };
  async function load() {
    loading(list);
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    try {
      const { items: found } = await api(`/cases${q ? `?${q}` : ''}`);
      const items = [...found].sort((a, b) => b.risk_score - a.risk_score || b.created_ms - a.created_ms);
      list.replaceChildren(items.length ? table(['Kasus', 'Risiko', 'Skor', 'Modus', 'Sinyal', 'Faskes', 'Status', 'Tarif', [NILAI_LABEL, info(NILAI_TIP)], 'Penjelasan', 'Umur'],
        items.map((c) => ({ attrs: { class: 'click', onclick: () => navigate(`#kasus/${c.case_id}`) }, cells: [h('button', { class: 'link mono', type: 'button', onclick: (e) => { e.stopPropagation(); navigate(`#kasus/${c.case_id}`); } }, c.case_id), badge(c.risk_level), c.risk_score, modusCell(c), sinyalCell(c), c.facilities.join(', '), statusBadge(c.status), rp(c.amount), rp(c.potensi_nilai_dipertanyakan), c.explanation_source ? sumberBadge(c.explanation_source) : '-', ago(c.created_ms)] })), { num: [2, 7, 8] })
        : h('p', { class: 'muted' }, 'Belum ada kasus untuk filter ini. Unggah CSV terlebih dahulu.'));
    } catch (e) { note(list, e.message); }
  }
  $('view').replaceChildren(h('h1', {}, 'Antrian kasus berisiko'), h('div', { class: 'card' }, h('div', { class: 'row' }, sel('risk', 'Risiko', ['HIGH', 'MEDIUM', 'LOW']), sel('status', 'Status', STATUSES), sel('modus', 'Modus / sinyal', MODI), sel('faskes', 'Faskes', (state.config?.facilities ?? []).map((x) => x.id))), list));
  load();
}

function revealBox(c) {
  const why = h('textarea', { id: 'reveal-reason', rows: 2, placeholder: 'Alasan pembukaan identitas (minimal 20 karakter)' }); const out = h('div', { 'aria-live': 'polite' });
  return h('section', { class: 'card' }, h('h2', {}, 'Buka identitas (hanya auditor, teraudit)'), h('p', { class: 'muted' }, 'Identitas adalah pengecualian: dicatat di audit, dihitung ke kuota, dan membutuhkan alasan tertulis.'),
    h('label', { for: 'reveal-reason' }, 'Alasan'), why,
    h('div', { class: 'actions' }, h('button', { class: 'btn alt', type: 'button', onclick: async () => { try { const r = await api(`/cases/${encodeURIComponent(c.case_id)}/reveal`, { method: 'POST', body: { reason: why.value } }); note(out, `Identitas peserta: ${r.patient_nik}. ${r.note}`, 'ok'); } catch (e) { note(out, e.message); } } }, 'Buka identitas')), out);
}

function fileRequests(c, items, role) {
  if (!items.length) return h('p', { class: 'muted' }, 'Belum ada permintaan berkas untuk kasus ini.');
  return table(['Permintaan', 'Nomor klaim', 'Catatan permintaan', 'Status', 'Balasan faskes'], items.map((r) => [r.request_id, r.claim_id, r.note, r.status === 'DIBALAS' ? 'Dibalas' : 'Menunggu faskes',
    r.reply ? h('div', {}, r.reply.note, r.reply.attachment ? h('div', {}, `Lampiran: ${r.reply.attachment.name} (${Math.ceil(r.reply.attachment.size / 1024)} KB) `, role === 'auditor' ? h('button', { class: 'link', type: 'button', onclick: () => download(`/file-requests/${r.request_id}/attachment`, r.reply.attachment.name).catch(() => {}) }, 'Unduh') : h('span', { class: 'muted' }, '(hanya auditor yang dapat membuka)')) : null) : '-']));
}

async function viewDetail(id) {
  const box = h('div'); loading(box);
  $('view').replaceChildren(h('p', {}, h('button', { class: 'link', type: 'button', onclick: () => navigate('#kasus') }, '← Kembali ke antrian')), box);
  try {
    const [c, fr] = await Promise.all([api(`/cases/${encodeURIComponent(id)}`), api(`/file-requests?case_id=${encodeURIComponent(id)}`).catch(() => ({ items: [] }))]);
    const role = state.user.role;
    const expl = h('p', {}, c.explanation || 'Membuat penjelasan...'); const src = h('span', {}, sumberBadge(c.explanation_source));
    const explain = () => { expl.textContent = 'Membuat penjelasan...'; return api(`/cases/${encodeURIComponent(id)}/explain`, { method: 'POST', body: {} }).then((r) => { expl.textContent = r.explanation; src.replaceChildren(sumberBadge(r.explanation_source)); }).catch((e) => { expl.textContent = e.message; }); };
    if (!c.explanation) explain();
    const msg = h('div', { 'aria-live': 'polite' });
    const refresh = () => viewDetail(id);
    const run = (fn) => async () => { try { await fn(); } catch (e) { note(msg, e.message); } };
    const parts = [
      h('h1', {}, `Kasus ${c.case_id}`),
      h('div', { class: 'card' },
        h('p', {}, badge(c.risk_level), ' ', statusBadge(c.status), ` · skor ${c.risk_score} · ${c.diagnosis_code} · tarif ${rp(c.amount)}`),
        h('div', { class: 'grid' }, h('div', { class: 'stat' }, h('b', {}, rp(c.potensi_nilai_dipertanyakan)), h('span', {}, NILAI_LABEL, info(NILAI_TIP)))),
        h('p', { class: 'muted' }, 'Token pasien: ', h('span', { class: 'mono' }, c.fraud_ref)),
        c.ml_status === 'unavailable' ? h('div', { class: 'msg err', role: 'alert' }, 'ML tidak tersedia: skor hanya dari detektor aturan.') : null,
        h('h3', {}, 'Alasan deteksi'), h('ul', { class: 'plain' }, c.flags.map((x) => h('li', {}, h('strong', {}, labelOf(x.modus)), ' ', h('span', { class: 'tag' }, x.modus.startsWith('ML_') ? 'ML' : 'Aturan'), `: ${x.reason}`))),
        h('h3', {}, 'Cara nilai dipertanyakan dihitung'), h('ul', { class: 'plain' }, c.modi.map((m) => h('li', {}, MODUS_RUMUS[m] ?? m))),
        h('h3', {}, 'Riwayat token lintas faskes'), timeline(c.history, c.claim_id),
        table(['Klaim', 'Faskes', 'Masuk', 'Lama rawat', 'Diagnosis', 'Tarif'], c.history.map((x) => [h('span', { class: 'mono' }, x.claim_id), x.facility_id, x.admit_date, `${x.length_of_stay} hari`, x.diagnosis_code, rp(x.amount)]), { num: [5] }),
        h('h3', {}, 'Penjelasan ', src), expl, h('button', { class: 'link', type: 'button', onclick: explain }, 'Buat ulang penjelasan')),
    ];
    if (['verifier', 'auditor'].includes(role)) {
      const status = h('select', { id: 'st' }, STATUSES.map((s) => h('option', { value: s, selected: s === c.status }, s.replaceAll('_', ' ')))); const nt = h('input', { id: 'st-note', placeholder: 'Catatan perubahan' });
      parts.push(h('section', { class: 'card' }, h('h2', {}, 'Tindak lanjut'),
        h('div', { class: 'row' }, h('div', {}, h('label', { for: 'st' }, 'Ubah status'), status), h('div', {}, h('label', { for: 'st-note' }, 'Catatan'), nt), h('div', {}, h('button', { class: 'btn', type: 'button', onclick: run(async () => { await api(`/cases/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: status.value, note: nt.value || undefined } }); refresh(); }) }, 'Simpan status'))),
        role === 'verifier' ? (() => {
          const rq = h('textarea', { id: 'rq-note', rows: 2, placeholder: 'Tulis berkas yang dibutuhkan, tanpa nama atau NIK. Gunakan nomor klaim.' });
          const es = h('textarea', { id: 'es-note', rows: 2, placeholder: 'Alasan butuh identitas peserta (mis. konfirmasi ke peserta atau proses hukum).' });
          return h('div', { class: 'cols' },
            h('div', {}, h('h3', {}, 'Minta berkas ke faskes'), h('p', { class: 'muted' }, `Permintaan dikirim ke ${c.facility_id} untuk klaim ${c.claim_id}. Faskes mengenal pasiennya; SAMAR tidak perlu membuka identitas.`), h('label', { for: 'rq-note' }, 'Catatan permintaan'), rq,
              h('div', { class: 'actions' }, h('button', { class: 'btn alt', type: 'button', onclick: run(async () => { await api(`/cases/${encodeURIComponent(id)}/request-file`, { method: 'POST', body: { note: rq.value } }); refresh(); }) }, 'Minta berkas ke faskes'))),
            h('div', {}, h('h3', {}, 'Eskalasi ke auditor'), h('p', { class: 'muted' }, 'Hanya auditor yang dapat membuka identitas, dengan alasan, kuota, dan audit.'), h('label', { for: 'es-note' }, 'Alasan eskalasi'), es,
              h('div', { class: 'actions' }, h('button', { class: 'btn alt', type: 'button', onclick: run(async () => { await api(`/cases/${encodeURIComponent(id)}/escalate`, { method: 'POST', body: { note: es.value } }); refresh(); }) }, 'Eskalasi ke auditor'))));
        })() : null, msg));
      parts.push(h('section', { class: 'card' }, h('h2', {}, 'Permintaan berkas ke faskes'), fileRequests(c, fr.items, role)));
    }
    parts.push(h('section', { class: 'card' }, h('h2', {}, 'Riwayat status'), h('ul', { class: 'plain' }, c.events.map((e) => h('li', {}, `${fmtTime(e.at_ms)} · ${e.actor}: ${e.from_status ?? '-'} → ${e.to_status}${e.note ? ` (${e.note})` : ''}`)))));
    if (role === 'auditor') parts.push(revealBox(c));
    box.replaceChildren(...parts);
  } catch (e) { note(box, e.message); }
}

export const viewKasus = (arg) => (arg ? viewDetail(arg) : viewDaftar());
