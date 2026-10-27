# Cheat sheet video

Semua angka di bawah diambil dari `reports/metrics.json` (dibuat 27 Okt 2026 oleh `npm run evaluate`). Jika evaluasi dijalankan ulang, angka berubah: jalankan `npm run report`, lalu cocokkan tabel ini. Angka yang tidak ada di tabel tidak boleh disebut sebagai hasil.

Ucapkan selalu bersama batasnya: **data sintetis, label dari generator, kapasitas review 1% adalah asumsi.**

## Angka yang boleh disebut

| Angka | Nilai | Asal (`metrics.json`) | Sebut sebagai |
|---|---|---|---|
| Paritas deteksi baseline vs SAMAR | 100% (387/387 klaim) | `stack.parity` | skor dan modus identik dengan dan tanpa tokenisasi |
| Payload di zona token yang memuat data pribadi | 100% menjadi 0% | `stack.privacy.*.pct_with_pii` | PII 0% di analitik (claims, fraud, notify) |
| Percobaan akses tidak sah ditolak | 23 dari 23 | `stack.security` | skrip evaluasi, bukan audit keamanan independen |
| Uji fungsional | 9 dari 9 | `stack.functional` | |
| Tes otomatis | 83 lulus | `npm test` | |
| Latensi POST /verify p95 | 22,1 ms (p50 17,2 ms) | `stack.verify` | satu mesin, memori, tanpa LLM eksternal |
| Throughput unggah CSV | 153,3 baris/detik | `stack.upload` | satu mesin, 1.000 baris |
| precision@1% (set hard) | 83,8% (min 47,6%, maks 100%) | `detection.summary.hard.full.precision_at_1pct` | rerata 6 run |
| Rupiah recall@1% (set hard) | 54,8% (23,8% sampai 85,1%) | `...rupiah_recall_at_1pct` | rerata 6 run; kapasitas 1% asumsi |
| PR-AUC (set hard) | 0,786 | `...pr_auc` | |
| PR-AUC set standar | 1,000 | `detection.summary.standard.full.pr_auc` | jenuh: bukti mekanisme, bukan akurasi; itu sebabnya set hard ditampilkan |
| Ablasi PR-AUC set hard | lengkap 0,786; tanpa lintas faskes 0,561; tanpa ML 0,553; ML saja 0,733 | `...no_cross`, `no_ml`, `no_rules` | fitur lintas faskes dan ML sama-sama menaikkan deteksi |
| Recall modus hold-out REPEAT_BILLING | set standar 100% (aturan, n=27); ML saja 0%; set hard 0% (n=37) | `detection.holdout` | **sebut rendah apa adanya.** Di set hard klaim ulang ditagih 38 hari kemudian, di luar jendela 30 hari, jadi tidak ada fitur yang melihatnya |
| Biaya pilot | sekitar Rp11,3 juta/bulan, Rp135,6 juta/tahun | `config/pilot-cost.json`, `docs/07-model-bisnis.md` | estimasi, bukan penawaran |
| Skenario dampak (asumsi) | rendah, sedang, tinggi | `GET /impact/scenarios` | rupiah recall 23,8% / 54,8% / 85,1%; fraud rate 1/3/5%; recovery 20/40/60%; nilai klaim cabang Rp4 triliun. Semua asumsi, jangan sebut sebagai penghematan nyata |

Jangan sebut: recall per modus di set hard yang mendekati 100% sebagai bukti generalisasi (model dilatih dari label generator yang sama); angka rupiah dampak sebagai hasil nyata; "akurasi" sistem pada data JKN.

Temuan otomatis eval-kit (sebut bila ditanya): kartu bukti menandai "Lemah pada CLONING, PROLONGED_LOS, REPEAT_BILLING, SELF_REFERRAL, UNBUNDLING" (set standar) dan "PROCEDURE_MISMATCH, REPEAT_BILLING, UNBUNDLING" (set hard) karena recall@k per modus pada kapasitas 21 klaim untuk 56 fraud memang terbatas kapasitas.

## Urutan klik demo yang sudah teruji

Diuji dengan Playwright pada sistem hasil `npm run demo:reset` lalu `npm start` (layanan ml aktif). Screenshot ada di `docs/screens/`.

1. **Login faskes** (`01-login`): klik tombol `Faskes: rs.melati`. Tab *Unggah CSV*: pilih `demo/fkrtl_batch_november_RS-A.csv`, klik *Unggah*. Hasil: 9 baris diterima, 2 kasus berisiko (`02-unggah`).
2. **Faskes kedua**: ketik `rs.kenanga` / `demo-kenanga`, unggah `demo/fkrtl_batch_november_RS-B.csv`. Hasil: 16 baris diterima, 3 kasus. Kasus lintas RS-A dan RS-B baru lengkap setelah langkah ini. (Alternatif satu langkah: verifikator mengunggah `demo/fkrtl_batch_november.csv`.)
3. **Login verifikator**: tombol `Verifikator: verifikator`. Tab *Kasus*: 5 kasus HIGH, diurutkan menurut skor; kasus teratas melibatkan RS-A dan RS-B (`03-daftar-kasus`).
4. **Buka kasus teratas** (`04-detail-kasus`): alasan deteksi, riwayat token lintas faskes, penjelasan (sumber `template` bila `LLM_API_KEY` kosong).
5. **Ubah status**: pilih `TERKONFIRMASI`, isi catatan, *Simpan* (`04b-status-terkonfirmasi`).
6. **Login auditor**: tombol `Auditor: auditor`. Buka kasus, isi alasan minimal 20 karakter, *Buka identitas* (`05-reveal`). Identitas yang tampil NIK sintetis berawalan 9999.
7. **Login admin**: tab *Audit & pengaturan*, klik *Verifikasi rantai audit* (`07-audit`): rantai valid, entri REIDENTIFY dan CASE_STATUS terlihat.
8. **Swagger**: http://localhost:3000/docs, `POST /verify` dengan token verifikator (respons sekitar 20 ms; angka resmi: p95 22,1 ms).
9. **Auditor, tab Dashboard & simulasi**: klik *Skenario Sedang*, *Hitung* (`06-dashboard-simulasi`). Tanda "asumsi" harus terlihat di layar.
10. **Auditor, tab Evaluasi** (`08-evaluasi`, `09-evidence-card`): tabel set standar dan hard, hold-out, tanpa vs dengan SAMAR, evidence card eval-kit.

Akun faskes selain RS-A tidak punya tombol di halaman login; ketik manual.

Cek sebelum rekam: `reports/metrics.json` ada, `npm test` hijau, tidak ada tab lain terbuka, tidak ada data riil di layar.
