# Cheat sheet video

Semua angka di bawah diambil dari `reports/metrics.json` (dibuat 27 Okt 2026 oleh `npm run evaluate`, setelah perbaikan T4). Jika evaluasi dijalankan ulang, angka berubah: jalankan `npm run report`, lalu cocokkan tabel ini. Angka yang tidak ada di tabel tidak boleh disebut sebagai hasil.

Ucapkan selalu bersama batasnya: **data sintetis, label dari generator, kapasitas review 1% adalah asumsi.** Nilai rupiah di kasus disebut **"potensi nilai dipertanyakan (estimasi)"**, bukan kerugian.

## Angka yang boleh disebut

| Angka | Nilai | Asal (`metrics.json`) | Sebut sebagai |
|---|---|---|---|
| Paritas deteksi baseline vs SAMAR | 100% (387/387 klaim) | `stack.parity` | skor dan modus identik dengan dan tanpa tokenisasi |
| Payload di zona token yang memuat data pribadi | 100% menjadi 0% | `stack.privacy.*.pct_with_pii` | PII 0% di analitik (claims, fraud, notify) |
| Percobaan akses tidak sah ditolak | 23 dari 23 | `stack.security` | skrip evaluasi, bukan audit keamanan independen |
| Uji fungsional | 9 dari 9 | `stack.functional` | |
| Latensi POST /verify p95 | 31,6 ms (p50 24,2 ms) | `stack.verify` | satu mesin, memori, tanpa LLM eksternal |
| Throughput unggah CSV | 321 baris/detik | `stack.upload` | satu mesin, 1.000 baris |
| precision@1% (set hard) | 86,2% | `detection.summary.hard.full.precision_at_1pct` | rerata 6 run |
| Recall nilai dipertanyakan @1% (set hard) | 58,3% (23,8% sampai 100%) | `...rupiah_recall_at_1pct` | rerata 6 run; kapasitas 1% asumsi. Nama kunci di berkas tetap `rupiah_recall` (kontrak eval-kit) |
| PR-AUC (set hard) | 0,923 | `...pr_auc` | |
| PR-AUC set standar | 1,000 | `detection.summary.standard.full.pr_auc` | jenuh: bukti mekanisme, bukan akurasi; itu sebabnya set hard ditampilkan |
| Ablasi PR-AUC set hard | lihat tabel di `reports/evaluation.md` bagian 4 | `...no_cross`, `no_ml`, `no_rules` | fitur lintas faskes dan ML sama-sama menaikkan deteksi |
| Recall modus hold-out REPEAT_BILLING | sebelum: set hard 0% (0/37), set standar 100% (27/27) lewat aturan. Sesudah jendela 90 hari: set hard 100% (37/37), set standar 100% (27/27). **ML saja: 0% di keduanya** | `detection.holdout` | **Sebut kenaikan ini by construction**: jarak klaim ulang 38 hari dibuat generator dan kini di dalam jendela. Itu bukan generalisasi; klaim ulang di luar 90 hari tetap lolos |
| Biaya pilot | sekitar Rp11,3 juta/bulan, Rp135,6 juta/tahun | `config/pilot-cost.json`, `docs/07-model-bisnis.md` | estimasi, bukan penawaran |
| Skenario dampak (asumsi) | rendah, sedang, tinggi | `GET /impact/scenarios` | recall nilai 23,8% / 58,3% / 100%; fraud rate 1/3/5%; recovery 20/40/60%; nilai klaim cabang Rp4 triliun. Semua asumsi, jangan sebut sebagai penghematan nyata |

Jangan sebut: recall per modus di set hard yang mendekati 100% sebagai bukti generalisasi (model dilatih dari label generator yang sama); angka rupiah dampak sebagai hasil nyata; "kerugian" untuk nilai di kasus; "akurasi" sistem pada data JKN.

Temuan otomatis eval-kit (sebut bila ditanya): kartu bukti menandai beberapa modus "Lemah" karena recall@k per modus pada kapasitas 21 klaim untuk 56 fraud memang terbatas kapasitas (lihat `reports/evaluation.md` bagian 11).

## Kalimat posisi (wajib, dari tinjauan kritis)
- "SAMAR melengkapi Voltage, FRISTA, VIDI, dan SIGAP, bukan menggantikan. Integrasi lewat adaptor API: rencana, belum terhubung."
- "Data sumber yang realistis dari sistem klaim BPJS. Unggah CSV hanya jalur pilot."
- "Verifikator tidak bisa membuka identitas. Butuh bukti: minta berkas ke faskes. Butuh identitas: eskalasi ke auditor."
- Jangan mengatakan masalah ini "belum ada solusinya".

## Urutan klik demo yang sudah teruji

Diuji dengan Playwright pada sistem hasil `npm run demo:reset` lalu `npm start` (layanan ml aktif). Screenshot ada di `docs/screens/`.

1. **Login faskes** (`01-login`): tombol `Faskes: rs.melati`. Beranda faskes kosong (`10-beranda-faskes-kosong`). Tab *Unggah CSV*, pilih `demo/fkrtl_batch_november_RS-A.csv`, klik *Unggah dan proses*. Layar proses menampilkan 3 tahap: Validasi 9, Tokenisasi 9, Selesai 9, tanpa skor atau kasus, plus pratinjau baris dengan NIK disamarkan (`02-unggah-proses-faskes`).
2. **Faskes kedua**: ketik `rs.kenanga` / `demo-kenanga`, unggah `demo/fkrtl_batch_november_RS-B.csv`. Untuk menunjukkan tabel baris gagal, tambah satu baris rusak ke berkas (`02b-unggah-baris-gagal`). Kasus lintas RS-A dan RS-B lengkap setelah langkah ini.
3. **Login verifikator** (tombol `Verifikator: verifikator`): beranda dengan antrian urut skor, kasus baru hari ini, per modus, umur kasus, aktivitas (`11-beranda-verifikator`). Tab *Kasus* (`03-daftar-kasus`) dan *Klaim* (`13-daftar-klaim-token`, filter `13b-klaim-filter`).
4. **Buka kasus teratas** (`04-detail-kasus`): alasan deteksi, riwayat token lintas faskes, penjelasan, potensi nilai dipertanyakan (estimasi) dengan tooltip rumus. Tidak ada tombol buka identitas.
5. **Minta berkas ke faskes**: isi catatan tanpa nama atau NIK, klik *Minta berkas ke faskes* (`12-minta-berkas`). Login faskes tujuan, tab *Permintaan berkas*, balas dengan catatan dan lampiran kecil (`14-faskes-balas-berkas`, `14b-faskes-sudah-dibalas`).
6. **Eskalasi**: verifikator klik *Eskalasi ke auditor* dengan alasan (`15-eskalasi`).
7. **Login auditor**: beranda dengan kasus eskalasi dan log reveal sendiri (`16-beranda-auditor`). Buka kasus, isi alasan minimal 20 karakter, *Buka identitas* (`05-reveal`). Identitas yang tampil NIK sintetis berawalan 9999.
8. **Auditor, Dashboard & simulasi**: *Skenario Sedang*, *Hitung* (`06-dashboard-simulasi`); tanda "asumsi" terlihat. Tab *Evaluasi* (`08-evaluasi`) memuat hasil, hold-out, evidence card, dan bagian "Posisi terhadap sistem BPJS yang ada".
9. **Login admin**: beranda dengan kesehatan layanan, kuota, audit terbaru (`17-beranda-admin`); *Audit & pengaturan*, *Verifikasi rantai audit* (`07-audit`).
10. **Swagger**: http://localhost:3000/docs, `POST /verify` dengan token verifikator (respons puluhan ms; angka resmi: p95 31,6 ms).

Akun faskes selain RS-A tidak punya tombol di halaman login; ketik manual.

Cek sebelum rekam: `reports/metrics.json` ada, `npm test` hijau, tidak ada tab lain terbuka, tidak ada data riil di layar, `npm run demo:reset` sebelum take baru (data bersih).
