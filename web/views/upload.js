// Unggah CSV dan layar proses: tahap Validasi, Tokenisasi, (Fitur lintas faskes, Deteksi, Kasus untuk staf) dengan angka tiap tahap.
import { $, h, api, state, note, table, rp, navigate, loading } from '../lib.js';

export function renderBatch(box, b) {
  const done = b.status === 'SELESAI';
  const processed = b.accepted + b.rejected;
  const progress = b.total ? Math.round((processed / b.total) * 100) : 0;
  const staff = state.user.role !== 'facility';
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Kemajuan unggahan', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(done ? 100 : progress) }, h('div'));
  bar.firstChild.style.width = `${done ? 100 : progress}%`;
  const parts = [
    h('h2', {}, `Proses unggahan ${b.batch_id}`),
    h('p', { role: 'status', 'aria-live': 'polite' }, done ? `Selesai. ${b.accepted} dari ${b.total} baris diterima, ${b.rejected} ditolak.` : b.status === 'GAGAL' ? 'Pemrosesan gagal.' : `Memproses ${processed} dari ${b.total} baris...`),
    bar,
    h('ol', { class: 'pipeline', 'aria-label': 'Tahap pemrosesan' }, b.stages.map((s, i) => h('li', { class: done || (s.count > 0 && i < b.stages.length) ? (done ? 'done' : 'active') : '' },
      h('span', { class: 't' }, `${i + 1}. ${s.label}`), h('span', { class: 'n' }, s.count.toLocaleString('id-ID')), h('span', { class: 'd' }, s.detail)))),
  ];
  if (done && staff) parts.push(h('div', { class: 'msg info', role: 'status' }, `${b.cases} kasus berisiko dibuat dari batch ini. `, h('button', { class: 'link', type: 'button', onclick: () => navigate('#kasus') }, 'Buka antrian kasus')));
  if (done && !staff) parts.push(h('div', { class: 'msg ok', role: 'status' }, 'Data diterima dan identitas peserta sudah diganti token. Hasil analisis hanya dilihat verifikator BPJS.'));
  parts.push(h('h3', {}, `Pratinjau ${b.preview.length} baris pertama`), h('p', { class: 'muted' }, 'NIK disamarkan di layar ini. Kolom nama dan telepon tidak ditampilkan.'));
  parts.push(table(['Baris', 'Nomor klaim', 'Faskes', 'Peserta', 'Tanggal masuk', 'Diagnosis', 'Tarif'], b.preview.map((r) => [r.row, r.claim_ref, r.facility_id, h('span', { class: 'mono' }, r.patient_hint), r.admit_date, r.diagnosis_code, rp(r.amount)]), { num: [6] }));
  if (b.errors.length) parts.push(h('h3', {}, `Baris gagal (${b.rejected})`), table(['Baris', 'Alasan'], b.errors.map((e) => [e.row, e.message])));
  box.replaceChildren(...parts);
}

async function poll(box, id) {
  for (let i = 0; i < 900 && box.isConnected; i += 1) {
    const b = await api(`/claims/batches/${encodeURIComponent(id)}`);
    renderBatch(box, b);
    if (b.status !== 'DIPROSES') return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function viewUnggah(arg) {
  const out = h('div', { 'aria-live': 'polite' }); const result = h('div');
  const file = h('input', { type: 'file', id: 'csv', accept: '.csv,text/csv' });
  const send = h('button', { class: 'btn', type: 'button', onclick: async () => {
    if (!file.files[0]) return note(out, 'Pilih file CSV dulu.');
    send.disabled = true; out.replaceChildren(); loading(result, 'Mengunggah...');
    try {
      const b = await api('/claims/upload?async=true', { method: 'POST', body: await file.files[0].text(), type: 'text/csv' });
      await poll(result, b.batch_id);
    } catch (e) { result.replaceChildren(); note(out, e.message); } finally { send.disabled = false; }
  } }, 'Unggah dan proses');
  $('view').replaceChildren(h('h1', {}, 'Unggah klaim'),
    h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Jalur pilot: berkas CSV. Di sistem nyata data klaim datang dari sistem klaim BPJS lewat API. Identitas peserta diganti token sebelum masuk zona analitik. Hanya data sintetis. Kolom: claim_ref, facility_id, patient_nik, patient_name, phone, birth_date, record_number, diagnosis_code, procedure_code, claim_type, admit_date, length_of_stay, amount (header kode BPJS PSTV01, FKL02, FKL47 juga diterima).'),
      h('div', { class: 'row' }, h('div', {}, h('label', { for: 'csv' }, 'Berkas CSV'), file), h('div', {}, send)), out),
    h('div', { class: 'card', id: 'proses' }, result));
  if (arg) { loading(result); poll(result, arg).catch((e) => note(result, e.message)); } else result.replaceChildren(h('p', { class: 'muted' }, 'Belum ada unggahan di layar ini. Tahap pemrosesan akan tampil setelah Anda mengunggah berkas.'));
}
