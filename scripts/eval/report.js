// Penulis laporan: reports/evaluation.md dan reports/data-card.md dari objek metrics (satu-satunya sumber angka).
import { HOLDOUT_MODUS, VARIANTS } from './offline.js';

const pct = (x) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(1)}%`);
const st = (s, f = pct) => (s ? `${f(s.mean)} (${f(s.min)} - ${f(s.max)})` : '-');
const ci = (c, v) => (c && c.lo !== null ? `${pct(v)} [${pct(c.lo)} - ${pct(c.hi)}]` : pct(v));
const table = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
const MODI = ['SELF_REFERRAL', 'PHANTOM_BILLING', 'CLONING', 'UPCODING', 'UNBUNDLING', 'REPEAT_BILLING', 'PROLONGED_LOS', 'PROCEDURE_MISMATCH'];

function headline(m, difficulty) {
  const s = m.detection.summary[difficulty];
  return table(['Varian', 'precision@1%', 'recall@1%', 'lift@1%', 'recall nilai dipertanyakan@1%', 'PR-AUC', 'ROC-AUC'],
    Object.entries(VARIANTS).map(([v, name]) => [name, st(s[v].precision_at_1pct), st(s[v].recall_at_1pct), st(s[v].lift_at_1pct, (x) => `${x.toFixed(1)}x`), st(s[v].rupiah_recall_at_1pct), st(s[v].pr_auc, (x) => x.toFixed(3)), st(s[v].roc_auc, (x) => x.toFixed(3))]));
}
function perModus(m, difficulty) {
  const s = m.detection.summary[difficulty];
  const modi = MODI.filter((x) => Object.values(s).some((v) => v?.per_modus_pooled?.[x]));
  return table(['Modus', 'Klaim uji (gabungan)', ...Object.values(VARIANTS)], modi.map((x) => [x === HOLDOUT_MODUS ? `${x} (hold-out)` : x, s.full.per_modus_pooled[x]?.n ?? 0,
    ...Object.keys(VARIANTS).map((v) => { const c = s[v].per_modus_pooled[x]; return c ? `${pct(c.recall)} [${pct(c.ci95.lo)} - ${pct(c.ci95.hi)}]` : '-'; })]));
}
function perRun(m, difficulty) {
  return table(['Seed', 'Fraud rate', 'Klaim uji', 'Fraud uji', 'precision@1% [CI95]', 'recall@1% [CI95]', 'recall nilai dipertanyakan@1% [CI95]', 'PR-AUC [CI95]'],
    m.detection.runs.filter((r) => r.difficulty === difficulty).map((r) => { const v = r.variants.full; return [r.seed, `${r.fraud_rate_target * 100}%`, v.n_test, v.n_fraud,
      ci(v.ci95.precision_1pct, v.capacity_1pct.precision), ci(v.ci95.recall_1pct, v.capacity_1pct.recall), ci(v.ci95.rupiah_recall_1pct, v.capacity_1pct.rupiah_recall), ci(v.ci95.pr_auc, v.pr_auc)]; }));
}

export function evaluationMd(m) {
  const d = m.detection; const p = m.stack; const hs = d.holdout;
  const ho = (diff, v) => (hs[diff][v] ? `${pct(hs[diff][v].recall)} [${pct(hs[diff][v].ci95.lo)} - ${pct(hs[diff][v].ci95.hi)}] dari ${hs[diff][v].n} klaim` : 'tidak ada klaim hold-out di set uji');
  const kit = m.evidence_card;
  const prim = d.runs.find((r) => r.seed === m.protocol.seeds[0] && r.fraud_rate_target === 0.03 && r.difficulty === 'standard');
  return `# Laporan Evaluasi SAMAR

Dibuat ${m.generated_at} · Node ${m.node} · ${m.platform}. Seluruh angka di berkas ini berasal dari \`reports/metrics.json\` (keluaran \`npm run evaluate\`).

## Batas yang harus dibaca lebih dulu
${m.limitations.map((x) => `- ${x}`).join('\n')}

## 1. Protokol
- Generator sintetis dengan ${m.protocol.seeds.length} seed (${m.protocol.seeds.join(', ')}) x fraud rate ${m.protocol.fraud_rates.map((x) => `${x * 100}%`).join(' dan ')} x 2 tingkat kesulitan (standar, hard) = ${d.runs.length} run, ${m.protocol.peserta} peserta per run.
- Split waktu: hari 0-${m.protocol.train_days - 1} (bulan 1-4) melatih model; hari ${m.protocol.train_days}-${m.protocol.span_days - 1} (bulan 5-6) menguji. Tidak ada pengacakan.
- Modus hold-out: ${HOLDOUT_MODUS}, dikeluarkan dari pelatihan model supervised dan dilaporkan terpisah.
- Hard negatives: pasien kronis kontrol rutin; pada set hard ditambah rujukan sah cepat dan kasus berat sah.
- Kapasitas review 1% klaim uji (asumsi). Dengan fraud rate 3%, recall@1% tidak mungkin melebihi sekitar sepertiga; karena itu recall@3% dan recall pada ambang kasus (skor >= ${m.protocol.case_threshold}) ikut dilaporkan.
- Selang kepercayaan 95%: bootstrap ${m.protocol.bootstrap.B} resampling per pasien. Angka ringkasan = rerata (min - maks) antar ${d.summary.standard.n_runs} run.

## 2. Hasil deteksi, set standar
${headline(m, 'standard')}

Set standar memakai pola fraud yang mirip dengan yang dikenal detektor. ${m.detection.saturation_note}

## 3. Hasil deteksi, set hard (skenario lebih sulit)
${headline(m, 'hard')}

Set hard: upcoding hanya 1,15-1,5x, cloning tersebar 12 hari, unbundling dan self-referral dekat batas jendela, klaim ulang di luar jendela 30 hari, perawatan sedikit di atas batas wajar, satu modus tanpa detektor aturan (PROCEDURE_MISMATCH), serta hard negatives tambahan.

## 4. Ablasi
Selisih terhadap SAMAR lengkap (rerata antar run), set hard:
${table(['Varian', 'PR-AUC', 'selisih', 'recall nilai dipertanyakan@1%', 'selisih'], Object.entries(VARIANTS).map(([v, name]) => [name, st(d.summary.hard[v].pr_auc, (x) => x.toFixed(3)), v === 'full' ? '-' : (d.summary.hard[v].pr_auc.mean - d.summary.hard.full.pr_auc.mean).toFixed(3), st(d.summary.hard[v].rupiah_recall_at_1pct), v === 'full' ? '-' : pct(d.summary.hard[v].rupiah_recall_at_1pct.mean - d.summary.hard.full.rupiah_recall_at_1pct.mean)]))}

Set standar:
${table(['Varian', 'PR-AUC', 'selisih', 'recall nilai dipertanyakan@1%', 'selisih'], Object.entries(VARIANTS).map(([v, name]) => [name, st(d.summary.standard[v].pr_auc, (x) => x.toFixed(3)), v === 'full' ? '-' : (d.summary.standard[v].pr_auc.mean - d.summary.standard.full.pr_auc.mean).toFixed(3), st(d.summary.standard[v].rupiah_recall_at_1pct), v === 'full' ? '-' : pct(d.summary.standard[v].rupiah_recall_at_1pct.mean - d.summary.standard.full.rupiah_recall_at_1pct.mean)]))}

"Tanpa fitur lintas faskes" membatasi riwayat token ke faskes yang sama (meniru sistem tanpa token lintas faskes), lalu detektor dan model dilatih ulang dengan fitur itu.

## 5. Recall per modus (ambang kasus, skor >= ${m.protocol.case_threshold}; gabungan semua run, CI Wilson 95%)
Set standar:
${perModus(m, 'standard')}

Set hard:
${perModus(m, 'hard')}

Catatan baca: recall per modus di set hard tinggi sebagian besar karena model supervised dilatih dari label generator yang sama (distribusi sama), bukan karena sistem sudah menggeneralisasi ke fraud baru. Ukuran generalisasi yang lebih jujur adalah modus hold-out di bawah, dan hasilnya rendah.

### Modus hold-out ${HOLDOUT_MODUS}
| Varian | Set standar | Set hard |
|---|---|---|
${['full', 'no_rules', 'no_cross', 'no_ml'].map((v) => `| ${VARIANTS[v]} | ${ho('standard', v)} | ${ho('hard', v)} |`).join('\n')}

Catatan baca (perbaikan T4): sebelum perbaikan jendela REPEAT_BILLING 30 hari; recall hold-out di set hard 0% (0 dari 37) pada semua varian karena klaim ulang di set hard ditagih 38 hari setelah klaim pertama, di luar jendela. Setelah jendela dilebarkan menjadi 90 hari angka itu naik, tetapi kenaikan ini by construction: jarak 38 hari dibuat generator dan kini berada di dalam jendela. Itu bukan bukti generalisasi. Ukuran generalisasi yang lebih jujur adalah varian "Tanpa aturan (ML saja)", yang tetap 0% karena model supervised tidak pernah melihat modus ini dan tidak ada aturan yang menangkapnya. Klaim ulang dengan jarak lebih dari 90 hari tetap lolos.

"Tanpa aturan (ML saja)" adalah ukuran generalisasi sebenarnya ke modus yang tidak dilihat model; pada varian lengkap, detektor aturan klaim berulang tetap menangkapnya karena aturan itu memang ada.

## 6. Hasil per run (SAMAR lengkap)
Set standar:
${perRun(m, 'standard')}

Set hard:
${perRun(m, 'hard')}

## 7. Paritas deteksi baseline vs SAMAR dan paparan data pribadi
Data: ${p.dataset.claims} klaim sintetis (${p.dataset.fraud_labeled} berlabel fraud), mode baseline (tanpa tokenisasi) dan proposed (dengan tokenisasi) pada layanan nyata, layanan ml ${p.ml_ready.baseline && p.ml_ready.proposed ? 'aktif' : 'TIDAK aktif di salah satu mode'}.

**Paritas:** ${p.parity.identical}/${p.parity.total} klaim (${p.parity.pct.toFixed(1)}%) menghasilkan skor dan modus identik. Precision ${pct(p.detection.proposed.precision)}, recall ${pct(p.detection.proposed.recall)} pada ambang kasus.

${table(['Zona / layanan', 'Payload (baseline)', 'Mengandung PII', 'Payload (SAMAR)', 'Mengandung PII'], Object.keys(p.privacy.baseline.services).map((s) => [s, p.privacy.baseline.services[s].payloads, p.privacy.baseline.services[s].with_pii, p.privacy.proposed.services[s].payloads, p.privacy.proposed.services[s].with_pii]))}

Total payload mengandung PII di zona token: **${p.privacy.baseline.pct_with_pii.toFixed(0)}% (baseline) menjadi ${p.privacy.proposed.pct_with_pii.toFixed(0)}% (SAMAR)**. ${p.privacy.note} Layanan ml hanya menerima 11 fitur numerik.

## 8. Kinerja
${table(['Mode', 'Rata-rata', 'p50', 'p95', 'p99', 'Throughput', 'Error'], ['baseline', 'proposed'].map((x) => [x, `${p.performance[x].mean_ms} ms`, `${p.performance[x].p50_ms} ms`, `${p.performance[x].p95_ms} ms`, `${p.performance[x].p99_ms} ms`, `${p.performance[x].tps} TPS`, p.performance[x].errors]))}

- Latensi POST /verify (SAMAR, ${p.verify.n} permintaan berurutan): p50 ${p.verify.p50_ms} ms, **p95 ${p.verify.p95_ms} ms**, maks ${p.verify.max_ms} ms.
- Throughput unggah CSV: ${p.upload.accepted} baris dalam ${p.upload.seconds} detik = **${p.upload.rows_per_sec} baris/detik**.
- ${p.performance.note}

## 9. Keamanan: ${p.security.rejected}/${p.security.total} percobaan tidak sah ditolak
${table(['Skenario', 'Diharapkan', 'Hasil', 'Status'], p.security.tests.map((t) => [t.name, t.expected, t.got, t.pass ? 'LULUS' : 'GAGAL']))}

## 10. Fungsional: ${p.functional.passed}/${p.functional.total} lulus
${p.functional.tests.map((t) => `- ${t.pass ? '[x]' : '[ ]'} ${t.name}`).join('\n')}

## 11. Evidence card eval-kit
${kit.ran ? `Dibuat dengan \`python -m hkeval evaluate ... --capacity 0.01 --strata level,region --data-source synthetic\` pada run seed ${m.protocol.seeds[0]}, fraud rate 3%, set standar (\`reports/evidence.html\`) dan set hard (\`reports/evidence-hard.html\`).

Konteks: kit menghitung recall@k per modus pada run seed ${prim.seed}, fraud rate 3% (${prim.variants.full.capacity_1pct.k} klaim ditandai untuk ${prim.variants.full.n_fraud} klaim fraud di set uji, kapasitas 1%). Recall@k per modus tidak mungkin tinggi karena kapasitas lebih kecil dari jumlah fraud; butir "Lemah" di bawah sebagian besar mencerminkan batas kapasitas itu dan tidak boleh dibaca sebagai recall pada ambang kasus (bagian 5).

Temuan keterbatasan otomatis dari kit (apa adanya), set standar:
${kit.limitations.length ? kit.limitations.map((x) => `- ${x}`).join('\n') : '- (kit tidak mencetak butir keterbatasan; baca bagian keterbatasan pada evidence.md)'}

Set hard:
${kit.hard_limitations.map((x) => `- ${x}`).join('\n')}` : `Tidak dibuat: ${kit.reason}`}

## 12. Simulasi dampak
Masukan skenario recall nilai dipertanyakan: rendah ${pct(m.impact_inputs.rupiah_recall.low)}, sedang ${pct(m.impact_inputs.rupiah_recall.mid)}, tinggi ${pct(m.impact_inputs.rupiah_recall.high)} (${m.impact_inputs.source}). Fraud rate, recovery rate, dan nilai klaim cabang adalah asumsi; hasil ada di halaman Evaluasi dan \`GET /impact/scenarios\`.
`;
}

export function dataCardMd(m) {
  const g = m.data_card;
  return `# Data card (sintetis)

Dihasilkan oleh \`npm run evaluate\` (generator \`scripts/generate-data\`, \`shared/synthetic.js\`). Seluruh data sintetis: NIK berawalan 9999, tidak ada data peserta JKN riil dan tidak ada data sampel resmi BPJS. Tarif referensi ilustratif, bukan INA-CBG resmi.

| Parameter | Nilai |
|---|---|
| seed | ${m.protocol.seeds.join(', ')} |
| fraud rate (target, dari klaim wajar) | ${m.protocol.fraud_rates.map((x) => `${x * 100}%`).join(', ')} |
| peserta per run | ${m.protocol.peserta} |
| rentang tanggal | ${m.protocol.span_days} hari sejak 2026-06-01 (hari 0-${m.protocol.train_days - 1} latih, ${m.protocol.train_days}-${m.protocol.span_days - 1} uji) |
| modus hold-out | ${HOLDOUT_MODUS} |
| tingkat kesulitan | standar dan hard |
| kapasitas review | 1% klaim uji (asumsi) |

## Ukuran data per run
| Tingkat | Seed | Fraud rate | Klaim total | Klaim latih | Klaim uji | Fraud uji |
|---|---|---|---|---|---|---|
${g.map((r) => `| ${r.difficulty} | ${r.seed} | ${r.fraud_rate_target * 100}% | ${r.n_all} | ${r.n_train} | ${r.variants.full.n_test} | ${r.variants.full.n_fraud} |`).join('\n')}

## Batas
${m.limitations.map((x) => `- ${x}`).join('\n')}
`;
}

// Blok hasil untuk README (diganti otomatis di antara penanda HASIL oleh scripts/render-readme.js).
export function readmeBlock(m) {
  const d = m.detection; const p = m.stack; const pr = m.protocol;
  const ho = (diff, v) => (d.holdout[diff][v] ? `${pct(d.holdout[diff][v].recall)} (n=${d.holdout[diff][v].n}, CI95 ${pct(d.holdout[diff][v].ci95.lo)}-${pct(d.holdout[diff][v].ci95.hi)})` : '-');
  const row = (diff, v) => { const x = d.summary[diff][v]; return [VARIANTS[v], st(x.precision_at_1pct), st(x.recall_at_1pct), st(x.rupiah_recall_at_1pct), x.pr_auc.mean.toFixed(3), x.roc_auc.mean.toFixed(3)]; };
  const head = ['Varian', 'precision@1%', 'recall@1%', 'recall nilai dipertanyakan@1%', 'PR-AUC', 'ROC-AUC'];
  return `Sumber: \`reports/metrics.json\` (dibuat ${m.generated_at.slice(0, 10)} oleh \`npm run evaluate\`). ${pr.seeds.length} seed x fraud rate ${pr.fraud_rates.map((x) => `${x * 100}%`).join('/')} x 2 tingkat kesulitan; latih bulan 1-4, uji bulan 5-6; kapasitas review 1% klaim (asumsi). Angka = rerata (min-maks) antar ${d.summary.standard.n_runs} run per tingkat.

**Set hard (skenario lebih sulit, angka utama):**

${table(head, Object.keys(VARIANTS).map((v) => row('hard', v)))}

**Set standar (pola fraud mirip generator; cenderung optimistis):**

${table(head, Object.keys(VARIANTS).map((v) => row('standard', v)))}

- Ablasi: baris "Tanpa fitur lintas faskes", "Tanpa ML", dan "Tanpa aturan" membandingkan kontribusi tiap komponen terhadap SAMAR lengkap.
- Modus hold-out ${pr.holdout_modus} (tidak dipakai melatih model supervised), recall pada ambang kasus: SAMAR lengkap ${ho('standard', 'full')} (standar) dan ${ho('hard', 'full')} (hard); **ML saja** ${ho('standard', 'no_rules')} (standar) dan ${ho('hard', 'no_rules')} (hard).
- Paritas deteksi baseline vs SAMAR: ${p.parity.identical}/${p.parity.total} klaim identik (${p.parity.pct.toFixed(1)}%). Payload di zona token yang memuat data pribadi: ${p.privacy.baseline.pct_with_pii.toFixed(0)}% menjadi ${p.privacy.proposed.pct_with_pii.toFixed(0)}%.
- Latensi POST /verify p95 ${p.verify.p95_ms} ms; throughput unggah CSV ${p.upload.rows_per_sec} baris/detik (satu mesin, penyimpanan memori).
- Keamanan: ${p.security.rejected}/${p.security.total} percobaan akses tidak sah ditolak; fungsional ${p.functional.passed}/${p.functional.total} lulus.
- Evidence card eval-kit: ${m.evidence_card.ran ? `\`reports/evidence.html\` dan \`reports/evidence-hard.html\` (${m.evidence_card.limitations.length} butir keterbatasan otomatis dari kit, lihat \`reports/evaluation.md\`).` : `belum dibuat (${m.evidence_card.reason}).`}
${d.saturation_note ? `\n> ${d.saturation_note}\n` : ''}`;
}
