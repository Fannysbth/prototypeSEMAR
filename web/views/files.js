// Faskes: permintaan berkas dari BPJS dan balasannya (catatan dan/atau lampiran kecil, maks 200 KB).
import { $, h, api, note, table, fmtTime, loading } from '../lib.js';

const MAX = 200 * 1024;
const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.onerror = () => reject(new Error('Gagal membaca berkas')); r.readAsDataURL(file); });

export async function viewBerkas() {
  const box = h('div'); loading(box);
  $('view').replaceChildren(h('h1', {}, 'Permintaan berkas dari BPJS'), box);
  async function load() {
    try {
      const { items } = await api('/file-requests');
      const waiting = items.filter((r) => r.status === 'MENUNGGU'); const done = items.filter((r) => r.status !== 'MENUNGGU');
      box.replaceChildren(h('div', {},
        h('p', { class: 'muted' }, 'Balas dengan catatan, atau lampirkan berkas kecil (pdf, png, jpg, txt, maks 200 KB). Jangan menulis nama atau NIK pasien di catatan: sistem menolaknya. Rujuk dengan nomor klaim.'),
        waiting.length ? waiting.map((r) => {
          const nt = h('textarea', { id: `n-${r.request_id}`, rows: 3 }); const fl = h('input', { type: 'file', id: `f-${r.request_id}`, accept: '.pdf,.png,.jpg,.jpeg,.txt' }); const out = h('div', { 'aria-live': 'polite' });
          return h('section', { class: 'card' }, h('h2', {}, `Klaim ${r.claim_id}`), h('p', {}, h('strong', {}, 'Permintaan: '), r.note), h('p', { class: 'muted' }, `${r.request_id} · ${fmtTime(r.created_ms)}`),
            h('label', { for: nt.id }, 'Catatan balasan'), nt, h('label', { for: fl.id }, 'Lampiran (opsional)'), fl,
            h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
              try {
                const file = fl.files[0];
                if (file && file.size > MAX) return note(out, 'Lampiran lebih dari 200 KB.');
                const body = { note: nt.value, ...(file ? { attachment: { name: file.name, content_base64: await toBase64(file) } } : {}) };
                await api(`/file-requests/${encodeURIComponent(r.request_id)}/reply`, { method: 'POST', body });
                await load();
              } catch (e) { note(out, e.message); }
            } }, 'Kirim balasan')), out);
        }) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Tidak ada permintaan yang menunggu balasan.')),
        done.length ? h('section', { class: 'card' }, h('h2', {}, 'Sudah dibalas'), table(['Nomor klaim', 'Permintaan', 'Balasan Anda', 'Lampiran'], done.map((r) => [r.claim_id, r.note, r.reply?.note ?? '-', r.reply?.attachment ? r.reply.attachment.name : '-']))) : null));
    } catch (e) { note(box, e.message); }
  }
  load();
}
