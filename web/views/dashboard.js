// Dashboard ringkasan dan simulasi dampak. Simulasi selalu berlabel asumsi; angka kasus adalah estimasi, bukan kerugian.
import { $, h, api, state, note, rp, download, info, NILAI_LABEL, NILAI_TIP } from '../lib.js';

const stat = (v, l, tip) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l, tip ? info(tip) : null));
function bars(title, obj) {
  const max = Math.max(1, ...Object.values(obj || {}));
  return h('div', {}, h('h3', {}, title), Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
    const fill = h('div', { class: 'bar-fill' }); fill.style.width = `${(100 * v) / max}%`;
    return h('div', { class: 'bar-row' }, h('div', {}, `${k.replaceAll('_', ' ')} (${v})`), h('div', { class: 'bar-track', role: 'img', 'aria-label': `${k}: ${v}` }, fill));
  }));
}
const SIM_LABEL = {
  potensi_nilai_dipertanyakan_rp: 'Potensi nilai dipertanyakan (asumsi)', nilai_terdeteksi_rp: 'Nilai terdeteksi (asumsi)', potensi_pemulihan_rp: 'Potensi pemulihan (asumsi)',
  biaya_operasional_rp: 'Biaya operasional setahun', potensi_penghematan_bersih_rp: 'Potensi manfaat bersih (asumsi)', rasio_manfaat_biaya: 'Rasio manfaat terhadap biaya (asumsi)', nilai_klaim_direview_rp: 'Nilai klaim direview',
};

export async function viewDashboard() {
  const box = h('div'); $('view').replaceChildren(h('h1', {}, 'Dashboard'), box);
  try {
    const d = await api('/dashboard/summary');
    box.append(h('div', { class: 'card' }, h('h2', {}, 'Ringkasan'),
      h('div', { class: 'grid' }, stat(d.claims_total, 'klaim dianalisis'), stat(d.cases_total, 'kasus'), stat(rp(d.potensi_nilai_dipertanyakan_total), NILAI_LABEL, NILAI_TIP), stat(d.tokens_active, 'token aktif'), stat(d.tokens_revoked, 'token dicabut'), stat(d.reveal_success, 'identitas dibuka')),
      h('div', { class: 'cols' }, bars('Kasus per tingkat risiko', d.cases_by_level), bars('Kasus per modus', d.cases_by_modus), bars('Kasus per faskes', d.cases_by_facility), bars('Kasus per status', d.cases_by_status)),
      h('p', { class: 'muted' }, 'Potensi nilai dipertanyakan adalah estimasi dari aturan deteksi, bukan angka audit dan bukan kerugian terkonfirmasi.')));
  } catch (e) { box.append(h('div', { class: 'card' }, h('div', { class: 'msg err', role: 'alert' }, e.message))); }
  if (!['auditor', 'admin'].includes(state.user.role)) return;
  const inp = (id, label, val) => h('div', {}, h('label', { for: id }, label), h('input', { id, value: val, inputmode: 'decimal' }));
  const out = h('div', { 'aria-live': 'polite' }); const scen = h('div', { class: 'actions' });
  const FIELDS = ['annual_claim_value', 'fraud_rate', 'rupiah_recall', 'recovery_rate', 'biaya_operasional'];
  const fill = (inputs) => FIELDS.forEach((k) => { $(k).value = String(inputs[k]); });
  box.append(h('div', { class: 'card' }, h('h2', {}, 'Simulasi dampak ', h('span', { class: 'badge status' }, 'asumsi')),
    h('p', { class: 'muted' }, 'Semua angka adalah asumsi yang bisa diubah. Recall nilai dipertanyakan (rupiah_recall) berasal dari hasil npm run evaluate pada data sintetis; kapasitas review 1% adalah asumsi. Biaya = estimasi pilot 1 cabang setahun dari docs/07-model-bisnis.md, bukan penawaran.'),
    scen,
    h('div', { class: 'row' }, inp('annual_claim_value', 'Nilai klaim tahunan cabang (Rp)', ''), inp('fraud_rate', 'fraud_rate (0-1)', ''), inp('rupiah_recall', 'rupiah_recall (0-1)', '')),
    h('div', { class: 'row' }, inp('recovery_rate', 'recovery_rate (0-1)', ''), inp('biaya_operasional', 'Biaya operasional setahun (Rp)', '')),
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
      const body = Object.fromEntries(FIELDS.map((k) => [k, Number($(k).value)]));
      if (FIELDS.some((k) => $(k).value === '')) return note(out, 'Isi semua kolom atau pilih skenario.');
      try { const r = await api('/impact/simulate', { method: 'POST', body }); out.replaceChildren(h('div', { class: 'grid' }, Object.entries(r.result).map(([k, v]) => stat(k.endsWith('_rp') ? rp(v) : String(v ?? '-'), SIM_LABEL[k] ?? k))), h('h3', {}, 'Asumsi'), h('ul', { class: 'plain' }, r.assumptions.map((a) => h('li', {}, a)))); } catch (e) { note(out, e.message); }
    } }, 'Hitung'), state.user.role === 'auditor' ? h('button', { class: 'btn alt', type: 'button', onclick: () => download('/reports/cases.csv', 'cases.csv').catch((e) => note(out, e.message)) }, 'Unduh laporan kasus (CSV)') : null), out));
  try {
    const { scenarios } = await api('/impact/scenarios');
    scen.append(...scenarios.map((x) => h('button', { class: 'btn alt', type: 'button', onclick: () => fill(x.inputs) }, `Skenario ${x.title}`)));
    const mid = scenarios.find((x) => x.id === 'sedang'); if (mid) fill(mid.inputs);
  } catch (e) { scen.append(h('span', { class: 'muted' }, `${e.message} Isi manual.`)); }
}
