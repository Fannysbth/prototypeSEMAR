// Beranda per peran. Faskes: riwayat unggahan dan kualitas data. Verifikator: antrian. Auditor: eskalasi. Admin: kesehatan sistem.
import { $, h, api, state, note, table, badge, statusBadge, modusCell, sinyalCell, labelOf, rp, fmtTime, ago, navigate, loading, info } from '../lib.js';

const stat = (v, l) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l));
const open = (hash, text) => h('button', { class: 'link', type: 'button', onclick: () => navigate(hash) }, text);
const bars = (title, obj, tip) => {
  const max = Math.max(1, ...Object.values(obj || {}));
  const rows = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  return h('div', {}, h('h3', {}, title, tip ? info(tip) : null), rows.length ? rows.map(([k, v]) => {
    const fill = h('div', { class: 'bar-fill' }); fill.style.width = `${(100 * v) / max}%`;
    return h('div', { class: 'bar-row' }, h('div', {}, `${labelOf(k)} (${v})`), h('div', { class: 'bar-track', role: 'img', 'aria-label': `${k}: ${v}` }, fill));
  }) : h('p', { class: 'muted' }, 'Belum ada data.'));
};

function facility(d) {
  const q = d.quality;
  return [
    h('div', { class: 'card' }, h('h2', {}, 'Kualitas data unggahan'),
      h('div', { class: 'grid' }, stat(q.total_rows, 'baris diunggah'), stat(q.accepted, 'baris diterima'), stat(q.rejected, 'baris ditolak'), stat(q.accepted_pct === null ? '-' : `${q.accepted_pct}%`, 'tingkat diterima')),
      q.top_errors.length ? [h('h3', {}, 'Alasan penolakan terbanyak'), table(['Alasan', 'Jumlah'], q.top_errors.map((e) => [e.message, e.count]), { num: [1] })] : h('p', { class: 'muted' }, 'Tidak ada baris ditolak.')),
    h('div', { class: 'card' }, h('h2', {}, `Permintaan berkas dari BPJS (${d.file_requests.length})`),
      d.file_requests.length ? [table(['Nomor klaim', 'Permintaan', 'Sejak'], d.file_requests.map((r) => [r.claim_id, r.note, fmtTime(r.created_ms)])), h('p', {}, open('#berkas', 'Balas permintaan'))] : h('p', { class: 'muted' }, 'Tidak ada permintaan yang menunggu.')),
    h('div', { class: 'card' }, h('h2', {}, 'Riwayat unggahan'), h('p', {}, h('button', { class: 'btn', type: 'button', onclick: () => navigate('#unggah') }, 'Unggah CSV baru')),
      d.uploads.length ? table(['Batch', 'Waktu', 'Status', 'Baris', 'Diterima', 'Ditolak'], d.uploads.map((b) => [open(`#unggah/${b.batch_id}`, b.batch_id), fmtTime(b.created_ms), b.status === 'SELESAI' ? 'Selesai' : b.status, b.total, b.accepted, b.rejected]), { num: [3, 4, 5] }) : h('p', { class: 'muted' }, 'Belum ada unggahan.')),
  ];
}

const caseTable = (items) => table(['Kasus', 'Risiko', 'Skor', 'Modus', 'Sinyal', 'Faskes', 'Status', 'Umur'], items.map((c) => [open(`#kasus/${c.case_id}`, c.case_id), badge(c.risk_level), c.risk_score, modusCell(c), sinyalCell(c), c.facilities.join(', '), statusBadge(c.status), ago(c.created_ms)]), { num: [2] });

function verifier(d) {
  return [
    h('div', { class: 'grid' }, stat(d.open_total, 'kasus terbuka'), stat(d.new_today, 'kasus baru hari ini'), stat(d.age.lt_1d, 'umur < 1 hari'), stat(d.age.d1_3, 'umur 1-3 hari'), stat(d.age.gt_3, 'umur > 3 hari')),
    h('div', { class: 'card' }, h('h2', {}, 'Antrian kasus (urut skor)'), d.queue.length ? caseTable(d.queue) : h('p', { class: 'muted' }, 'Belum ada kasus. Unggah CSV terlebih dahulu.'), h('p', {}, open('#kasus', 'Lihat semua kasus'))),
    h('div', { class: 'cols' },
      h('div', { class: 'card' }, h('h2', {}, 'Kasus terbuka per modus'), bars('', d.by_modus)),
      h('div', { class: 'card' }, h('h2', {}, 'Aktivitas sistem terbaru'), d.activity.length ? h('ul', { class: 'feed' }, d.activity.map((e) => h('li', {}, `${fmtTime(e.at_ms)} · `, open(`#kasus/${e.case_id}`, e.case_id), ` · ${e.actor}: ${e.from_status ?? '-'} → ${e.to_status}${e.note ? ` (${e.note})` : ''}`))) : h('p', { class: 'muted' }, 'Belum ada aktivitas.'))),
  ];
}

function auditor(d) {
  return [
    h('div', { class: 'card' }, h('h2', {}, `Kasus eskalasi dari verifikator (${d.escalated.length})`), d.escalated.length ? [caseTable(d.escalated), h('p', { class: 'muted' }, 'Identitas hanya dibuka dari halaman kasus, dengan alasan tertulis. Setiap pembukaan masuk audit dan kuota.')] : h('p', { class: 'muted' }, 'Tidak ada kasus eskalasi.')),
    h('div', { class: 'card' }, h('h2', {}, 'Log pembukaan identitas milik Anda'), d.my_reveals.length ? table(['#', 'Waktu', 'Kasus', 'Hasil'], d.my_reveals.map((r) => [r.seq, fmtTime(r.ts_ms), r.case_id ?? '-', r.status])) : h('p', { class: 'muted' }, 'Belum ada pembukaan identitas.')),
  ];
}

function admin(d) {
  return [
    h('div', { class: 'grid' }, ...Object.entries(d.services).map(([k, ok]) => stat(ok ? 'Sehat' : 'Mati', `layanan ${k}`)), stat(d.audit.valid ? 'Valid' : 'RUSAK', `rantai audit (${d.audit.entries} entri)`)),
    h('div', { class: 'cols' },
      h('div', { class: 'card' }, h('h2', {}, 'Kuota pembukaan identitas'), h('p', { class: 'muted' }, `Batas ${d.quota.max_per_hour} per jam dan ${d.quota.max_per_day} per hari untuk tiap auditor.`),
        d.quota.usage.length ? table(['Auditor', 'Jam terakhir', 'Hari terakhir'], d.quota.usage.map((u) => [u.actor, `${u.last_hour} / ${d.quota.max_per_hour}`, `${u.last_day} / ${d.quota.max_per_day}`])) : h('p', { class: 'muted' }, 'Belum ada pemakaian kuota.')),
      h('div', { class: 'card' }, h('h2', {}, 'Audit terbaru'), table(['#', 'Waktu', 'Aksi', 'Aktor', 'Hasil'], d.recent_audit.map((a) => [a.seq, fmtTime(a.ts_ms), a.action, a.actor ?? '-', a.status])), h('p', {}, open('#audit', 'Audit dan pengaturan')))),
  ];
}

export async function viewBeranda() {
  const box = h('div'); loading(box);
  $('view').replaceChildren(h('h1', {}, `Beranda ${{ facility: state.user.name, verifier: 'verifikator', auditor: 'auditor', admin: 'admin dan DPO' }[state.user.role]}`), box);
  try {
    const d = await api('/home');
    box.replaceChildren(...({ facility, verifier, auditor, admin }[d.role](d)));
  } catch (e) { note(box, e.message); }
}
