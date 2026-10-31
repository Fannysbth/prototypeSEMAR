// Halaman evaluasi (auditor dan admin): metrik, ablasi, hold-out, tanpa vs dengan SAMAR, evidence card, dan posisi terhadap sistem BPJS.
import { $, h, api, state, note, table, pct, loading } from '../lib.js';

const st = (s) => (s ? `${pct(s.mean)} (${pct(s.min)}-${pct(s.max)})` : '-');
const VARIAN = { full: 'SAMAR lengkap', no_ml: 'Tanpa ML (aturan saja)', no_rules: 'Tanpa aturan (ML saja)', no_cross: 'Tanpa fitur lintas faskes' };

export function posisiBpjs() {
  return h('section', { class: 'card' }, h('h2', {}, 'Posisi terhadap sistem BPJS yang ada'),
    h('p', {}, 'SAMAR ', h('strong', {}, 'melengkapi'), ', bukan menggantikan, sistem yang sudah dipakai BPJS Kesehatan seperti Voltage (tokenisasi), FRISTA, VIDI, dan SIGAP. SAMAR tidak mengklaim masalah ini belum punya solusi.'),
    h('ul', { class: 'plain' },
      h('li', {}, h('strong', {}, 'Yang ditambahkan: '), 'token yang konsisten lintas faskes untuk satu tujuan, berbeda antar tujuan, berotasi, dan bisa dicabut, lalu dipakai untuk deteksi lintas faskes dan alur kasus yang memisahkan peran (verifikator menilai dari pola, identitas hanya lewat auditor).'),
      h('li', {}, h('strong', {}, 'Integrasi: '), 'lewat adaptor API (misalnya adaptor Voltage sebagai mesin token). Rencana, belum terhubung ke sistem BPJS mana pun.'),
      h('li', {}, h('strong', {}, 'Sumber data: '), 'di sistem nyata data klaim berasal dari sistem klaim BPJS (VClaim, PCare) lewat API. Unggah CSV di prototype ini hanya jalur pilot.'),
      h('li', {}, h('strong', {}, 'Batas: '), 'semua angka di halaman ini dari data sintetis; ini bukti mekanisme, bukan akurasi pada data JKN riil.')));
}

// Kartu detail dilipat agar halaman terbaca sekilas. Iframe (evidence card) baru dimuat saat dibuka: iframe di luar layar
// pada kartu tertutup tidak digambar dengan benar oleh sebagian peramban, sehingga tampil kosong.
function fold(card) {
  if (card.tagName !== 'DIV' || !card.classList.contains('card') || card.firstElementChild?.tagName !== 'H2') return card;
  const title = card.firstElementChild;
  const d = h('details', { class: 'card fold' }, h('summary', {}, title.textContent));
  title.remove();
  d.append(h('div', { class: 'fold-body' }, ...card.childNodes));
  d.addEventListener('toggle', () => { if (d.open) for (const f of d.querySelectorAll('iframe[data-src]')) { f.src = f.dataset.src; f.removeAttribute('data-src'); } });
  return d;
}

const stat = (v, l, sub) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, l), sub ? h('span', { class: 'sub' }, sub) : null);

export async function viewEvaluasi() {
  const box = h('div'); loading(box);
  $('view').replaceChildren(h('h1', {}, 'Evaluasi'), box);
  let m;
  try { m = await api('/evaluation/latest'); } catch (e) { box.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'msg err', role: 'alert' }, `${e.message} Jalankan: npm run evaluate`)), posisiBpjs()); return; }
  const d = m.detection; const p = m.stack; const pr = m.protocol;
  const f1 = (x) => pct(x);
  const parts = [h('div', { class: 'card' }, h('h2', {}, 'Hasil deteksi (data sintetis)'),
    h('div', { class: 'msg err', role: 'note' }, 'Angka ini dari data sintetis dengan label dari generator; kapasitas review 1% adalah asumsi. Ini bukti mekanisme, bukan akurasi pada data JKN riil.'),
    h('p', { class: 'muted' }, `${pr.seeds.length} seed x fraud rate ${pr.fraud_rates.map((x) => `${x * 100}%`).join('/')} x 2 tingkat kesulitan. Latih hari 0-${pr.train_days - 1} (bulan 1-4), uji bulan 5-6. Modus hold-out: ${pr.holdout_modus}. Angka = rerata (min-maks) antar run. Dibuat ${new Date(m.generated_at).toLocaleString('id-ID')}. "Recall nilai" = porsi potensi nilai dipertanyakan yang tertangkap pada kapasitas review 1%.`),
    ...['standard', 'hard'].flatMap((df) => [h('h3', {}, df === 'standard' ? 'Set standar' : 'Set hard (skenario lebih sulit)'),
      table(['Varian', 'precision@1%', 'recall@1%', 'recall nilai@1%', 'PR-AUC', 'ROC-AUC'], Object.entries(VARIAN).map(([v, name]) => { const x = d.summary[df][v]; return [name, st(x.precision_at_1pct), st(x.recall_at_1pct), st(x.rupiah_recall_at_1pct), x.pr_auc ? x.pr_auc.mean.toFixed(3) : '-', x.roc_auc ? x.roc_auc.mean.toFixed(3) : '-']; }), { num: [4, 5] })]),
    d.saturation_note ? h('p', { class: 'muted' }, d.saturation_note) : null,
    h('p', { class: 'muted' }, 'Ablasi: bandingkan baris "SAMAR lengkap" dengan "Tanpa fitur lintas faskes", "Tanpa ML", dan "Tanpa aturan".'))];
  const ho = (df, v) => { const x = d.holdout[df][v]; return x ? `${f1(x.recall)} [${f1(x.ci95.lo)}-${f1(x.ci95.hi)}], n=${x.n}` : '-'; };
  parts.push(h('div', { class: 'card' }, h('h2', {}, `Modus hold-out: ${pr.holdout_modus}`), h('p', { class: 'muted' }, 'Tidak dipakai melatih model supervised. Recall pada ambang kasus (skor >= 45), gabungan semua run, CI Wilson 95%.'),
    table(['Varian', 'Set standar', 'Set hard'], ['full', 'no_rules', 'no_cross', 'no_ml'].map((v) => [VARIAN[v], ho('standard', v), ho('hard', v)]))));
  const pii = p.privacy;
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Tanpa SAMAR vs dengan SAMAR'),
    table(['Ukuran', 'Tanpa SAMAR (baseline)', 'Dengan SAMAR'], [
      ['Paritas deteksi (skor dan modus identik)', '-', `${p.parity.pct.toFixed(1)}% (${p.parity.identical}/${p.parity.total} klaim)`],
      ['Precision / recall pada ambang kasus', `${f1(p.detection.baseline.precision)} / ${f1(p.detection.baseline.recall)}`, `${f1(p.detection.proposed.precision)} / ${f1(p.detection.proposed.recall)}`],
      ['Payload zona token yang memuat PII', `${pii.baseline.pct_with_pii.toFixed(0)}%`, `${pii.proposed.pct_with_pii.toFixed(0)}%`],
      ['Latensi unggah klaim p95', `${p.performance.baseline.p95_ms} ms`, `${p.performance.proposed.p95_ms} ms`],
      ['Latensi POST /verify p95', '-', `${p.verify.p95_ms} ms`], ['Throughput unggah CSV', '-', `${p.upload.rows_per_sec} baris/detik`]]),
    h('h3', {}, 'Paparan PII per zona'),
    table(['Zona / layanan', 'Payload baseline', 'Mengandung PII', 'Payload SAMAR', 'Mengandung PII'], Object.keys(pii.baseline.services).map((k) => [k, pii.baseline.services[k].payloads, pii.baseline.services[k].with_pii, pii.proposed.services[k].payloads, pii.proposed.services[k].with_pii]), { num: [1, 2, 3, 4] }),
    h('p', { class: 'muted' }, `Gateway, privacy, dan vault memegang data pribadi by design. ${p.security.rejected}/${p.security.total} percobaan akses tidak sah ditolak; ${p.functional.passed}/${p.functional.total} uji fungsional lulus.`)));
  const ev = m.evidence_card;
  parts.push(h('div', { class: 'card' }, h('h2', {}, 'Evidence card (eval-kit)'),
    ev.ran ? h('div', {}, ...['evidence.html', 'evidence-hard.html'].flatMap((f) => [h('h3', {}, f === 'evidence.html' ? 'Set standar' : 'Set hard'),
      h('a', { href: `/api/v1/evaluation/evidence?file=${f}&access_token=${encodeURIComponent(state.token)}`, target: '_blank', rel: 'noopener' }, 'Buka di tab baru'),
      h('iframe', { 'data-src': `/api/v1/evaluation/evidence?file=${f}&access_token=${encodeURIComponent(state.token)}`, title: `Evidence card ${f === 'evidence.html' ? 'set standar' : 'set hard'}`, class: 'evidence', sandbox: 'allow-scripts' })]),
      h('h3', {}, 'Temuan keterbatasan otomatis dari kit'), h('ul', { class: 'plain' }, (ev.limitations.length ? ev.limitations : ['(tidak ada butir)']).map((x) => h('li', {}, x))))
      : h('div', { class: 'msg err', role: 'alert' }, `Evidence card belum dibuat: ${ev.reason}`)));
  parts.push(posisiBpjs());
  const hard = d.summary.hard.full; const std = d.summary.standard.full;
  const ringkas = h('div', { class: 'card' }, h('h2', {}, 'Ringkasan (data sintetis)'),
    h('div', { class: 'grid' },
      stat(hard.pr_auc.mean.toFixed(3), 'PR-AUC, set hard', `set standar ${std.pr_auc.mean.toFixed(3)} (cenderung optimistis)`),
      stat(pct(hard.precision_at_1pct.mean), 'precision@1% klaim, set hard', `set standar ${pct(std.precision_at_1pct.mean)}; kapasitas 1% adalah asumsi`),
      stat(`${p.parity.pct.toFixed(1)}%`, 'paritas deteksi dengan vs tanpa SAMAR', `${p.parity.identical} dari ${p.parity.total} klaim identik`),
      stat(`${pii.baseline.pct_with_pii.toFixed(0)}% → ${pii.proposed.pct_with_pii.toFixed(0)}%`, 'payload zona token yang memuat PII', 'tanpa SAMAR → dengan SAMAR')),
    h('p', { class: 'muted' }, 'Angka dari data sintetis dengan label generator: bukti mekanisme, bukan akurasi pada data JKN riil. Rincian per varian, modus, dan evidence card ada di bagian yang bisa dibuka di bawah.'));
  box.replaceChildren(ringkas, ...parts.map(fold));
}
