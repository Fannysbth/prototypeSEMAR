// Linimasa visual riwayat token lintas faskes: satu baris per faskes, satu blok per kunjungan atau rawat inap.
// Blok dari faskes berbeda yang tumpang tindih diberi warna lain. Tabel riwayat tetap ada di bawahnya sebagai padanan teks.
import { h, rp } from '../lib.js';

const DAY = 86400000;
const t = (d) => Date.parse(`${d}T00:00:00Z`);
const fmt = (ms) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function buildBlocks(history, currentClaimId) {
  const blocks = history.map((x) => ({ ...x, start: t(x.admit_date), end: t(x.admit_date) + Math.max(1, x.length_of_stay) * DAY, current: x.claim_id === currentClaimId }));
  for (const a of blocks) a.overlap = blocks.some((b) => b !== a && b.facility_id !== a.facility_id && a.start < b.end && b.start < a.end);
  return blocks;
}

export function timeline(history, currentClaimId) {
  if (!history.length) return h('p', { class: 'muted' }, 'Belum ada riwayat.');
  const blocks = buildBlocks(history, currentClaimId);
  const min = Math.min(...blocks.map((b) => b.start)); const max = Math.max(...blocks.map((b) => b.end));
  const span = Math.max(max - min, 7 * DAY);
  const pos = (ms) => `${(100 * (ms - min)) / span}%`;
  const facilities = [...new Set(blocks.map((b) => b.facility_id))];
  const label = (b) => `${b.facility_id}, klaim ${b.claim_id}: masuk ${fmt(b.start)}, ${b.length_of_stay} hari, diagnosis ${b.diagnosis_code}, tarif ${rp(b.amount)}${b.overlap ? '. Tumpang tindih dengan faskes lain' : ''}${b.current ? '. Klaim kasus ini' : ''}`;
  const rows = facilities.map((f) => {
    const track = h('div', { class: 'tl-track' }, blocks.filter((b) => b.facility_id === f).map((b) => {
      const el = h('div', { class: `tl-block${b.overlap ? ' overlap' : ''}${b.current ? ' current' : ''}`, role: 'img', 'aria-label': label(b), title: label(b), tabindex: 0 }, h('span', {}, fmt(b.start)));
      el.style.left = pos(b.start); el.style.width = `max(${(100 * (b.end - b.start)) / span}%, 14px)`;
      return el;
    }));
    return h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }, f), track);
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => h('span', {}, fmt(min + p * span)));
  return h('div', { class: 'timeline' },
    h('div', { class: 'tl-rows' }, rows),
    h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }), h('div', { class: 'tl-axis' }, ticks)),
    h('div', { class: 'tl-legend' },
      h('span', {}, h('i', { class: 'tl-key' }), ' Kunjungan atau rawat inap'),
      h('span', {}, h('i', { class: 'tl-key overlap' }), ' Tumpang tindih lintas faskes'),
      h('span', {}, h('i', { class: 'tl-key current' }), ' Klaim kasus ini')));
}
