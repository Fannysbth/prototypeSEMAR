// Audit dan pengaturan admin: ambang kasus, cabut token, rotasi epoch, verifikasi rantai audit, eval-kit, log audit.
import { $, h, api, note, table, fmtTime, download } from '../lib.js';

export async function viewAudit() {
  const box = h('div'); $('view').replaceChildren(h('h1', {}, 'Audit dan pengaturan'), box);
  const msg = h('div', { 'aria-live': 'polite' });
  const field = (id, label) => h('div', {}, h('label', { for: id }, label), h('input', { id }));
  const run = (fn) => async () => { try { await fn(); } catch (e) { note(msg, e.message); } };
  const th = await api('/settings/threshold').catch(() => ({ case_score: '?' }));
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Pengaturan dan tindakan admin'), msg,
    h('div', { class: 'row' }, field('thr', `Ambang kasus (sekarang ${th.case_score})`), h('div', {}, h('button', { class: 'btn', type: 'button', onclick: run(async () => { const r = await api('/settings/threshold', { method: 'PUT', body: { case_score: Number(document.getElementById('thr').value) } }); note(msg, `Ambang kasus menjadi ${r.case_score}.`, 'ok'); viewAudit(); }) }, 'Ubah ambang'))),
    h('div', { class: 'row' }, field('rv', 'Token peserta yang dicabut (PSE_FRD_...)'), h('div', {}, h('button', { class: 'btn alt', type: 'button', onclick: run(async () => { const r = await api('/tokens/revoke', { method: 'POST', body: { subject_token: document.getElementById('rv').value.trim() } }); note(msg, `${r.revoked} token dicabut. Klaim baru dari peserta ini ditolak di analitik.`, 'ok'); }) }, 'Cabut token'))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn alt', type: 'button', onclick: run(async () => { const r = await api('/keys/rotate', { method: 'POST', body: {} }); note(msg, `Epoch baru dimulai (rotasi ke-${r.rotation}). Token baru berbeda dari token sebelumnya.`, 'ok'); }) }, 'Rotasi epoch'),
      h('button', { class: 'btn alt', type: 'button', onclick: run(async () => { const r = await api('/audit/verify'); note(msg, r.valid ? `Rantai audit valid (${r.entries} entri).` : `Rantai audit RUSAK pada entri ${r.broken_at}.`, r.valid ? 'ok' : 'err'); }) }, 'Verifikasi rantai audit'),
      h('button', { class: 'btn alt', type: 'button', onclick: run(() => download('/export/evalkit', 'evalkit.zip')) }, 'Unduh eval-kit'))));
  try {
    const { items } = await api('/audit?limit=100');
    box.append(h('div', { class: 'card' }, h('h2', {}, 'Log audit (100 terbaru)'), table(['#', 'Waktu', 'Aksi', 'Hasil', 'Aktor', 'Kasus / target', 'Alasan', 'Hash'],
      items.map((a) => [a.seq, fmtTime(a.ts_ms), a.action, a.status, `${a.actor ?? '-'}${a.actor_role ? ` (${a.actor_role})` : ''}`, h('span', { class: 'mono' }, a.case_id ?? '-'), a.reason ?? (a.justification_len ? `alasan ${a.justification_len} karakter (isi tidak disimpan)` : '-'), h('span', { class: 'mono' }, (a.hash ?? '').slice(0, 10))]))));
  } catch (e) { box.append(h('div', { class: 'card' }, h('div', { class: 'msg err', role: 'alert' }, e.message))); }
}
