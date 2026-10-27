# Rencana ML dan Evaluasi

## Lapisan deteksi
1. **7 detektor aturan** (fraud service), skor 0..1 + alasan:
   self-referral, cloning (fokus: klaim identik/tumpang tindih lintas faskes), phantom billing, upcoding, unbundling, repeat billing, prolonged LOS.
2. **Isolation Forest** (ml service), tanpa label, menangkap pola aneh di luar aturan.
3. **Model supervised** (ml service), Gradient Boosting atau Random Forest dengan StandardScaler, dilatih dari label kasus.
4. **Gabungan**: `skor = 100 * (1 - Π(1 - w_i * s_i))` (noisy-OR). Kasus dibuat jika skor >= 45. Bobot `w_i` di `config/weights.json`.
5. **Manusia memutuskan.** Status TERKONFIRMASI dan DITOLAK_FALSE_POSITIVE dari verifikator menjadi label baru untuk latih ulang.

## Fitur lintas faskes (inti nilai SAMAR)
Semua dihitung per `subject_token`, tanpa identitas:
- `n_faskes_30d`, `n_kunjungan_30d`, `n_rs_7d`
- `overlap_inap_hari` (rawat inap tumpang tindih di faskes berbeda)
- `same_diag_multi_faskes_14d`
- `referral_loop` (A rujuk B, B rujuk A dalam 30 hari)
- `los_vs_median_inacbg`, `billed_vs_median_inacbg`, `selisih_tagih_verifikasi` (FKL47 - FKL48)
- `n_prosedur_terpisah_sehari` (unbundling)
- `jarak_kab_kota_faskes` (kunjungan berjauhan di hari yang sama)
- Fitur faskes: rasio kasus berisiko faskes 90 hari terakhir

## Penjelasan LLM
- Masukan: token, kode ICD, angka fitur teratas, alasan detektor. Tidak ada nama, NIK, tanggal lahir.
- Prompt meminta 3 sampai 5 kalimat Bahasa Indonesia untuk verifikator: apa yang janggal, bukti, langkah cek yang disarankan. Dilarang menyimpulkan "fraud".
- Penyedia diatur lewat `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`. Timeout 5 detik.
- Fallback: templat dari alasan detektor. Field `explanation_source` menunjukkan sumbernya.
- Tes: penyaring PII menolak permintaan ke LLM jika ada pola NIK (16 digit) atau nama dari vault.

## Evaluasi
Perintah: `npm run evaluate` menghasilkan:
- `reports/metrics.json` dan `reports/evaluation.md`
- `reports/evalkit/scores.csv` (`entity_id, group_id, score, stratum`) dan `truth.csv` (`entity_id, label, modus, excess_rupiah`)
- Evidence card: `python -m hkeval evaluate --scores scores.csv --truth truth.csv --capacity 0.01 --strata level,region --data-source synthetic --out reports/evidence.html`

Metrik utama: precision@k, lift, recall@k, rupiah recall pada kapasitas 1% klaim, PR-AUC, ROC-AUC, recall per modus, bootstrap CI.
Metrik privasi: paritas deteksi baseline vs proposed, paparan PII per zona, hasil tes keamanan.
Metrik sistem: latensi p95 `/verify`, throughput unggah batch.

Aturan agar hasil tidak semu:
- Generator dan detektor dibuat terpisah, parameter generator divariasikan (3 seed, 2 fraud rate: 1% dan 3%).
- Satu modus hold-out dari pelatihan supervised dan dilaporkan terpisah.
- Hard negatives wajib ada.
- Split latih/uji berdasarkan waktu (bulan 1-4 latih, 5-6 uji), bukan acak.
- Ablasi: tanpa fitur lintas faskes, tanpa ML, tanpa aturan. Ini bukti bahwa token lintas faskes yang membuat deteksi naik.
- Jika hasil 100%, laporkan sebagai bukti mekanisme dan tunjukkan skenario yang lebih sulit.

Batas yang ditulis di laporan: data sintetis, label dari generator, kapasitas 1% adalah asumsi.
