# PRD SAMAR

## 1. Masalah
Fraud klaim JKN sering baru terlihat jika riwayat seorang peserta dilihat lintas faskes: klaim ganda di dua rumah sakit, rawat inap yang tumpang tindih, rujukan berputar. Data seperti ini sensitif. Membukanya utuh ke setiap analis atau model memperbesar risiko kebocoran, sementara menutupnya membuat pola lintas faskes tidak terbaca.

SAMAR mengganti identitas dengan token yang konsisten lintas faskes. Riwayat bisa digabung dan dianalisis, tetapi identitas hanya bisa dibuka oleh peran tertentu, dengan alasan, kuota, dan jejak audit.

## 2. Tujuan dan ukuran
| Tujuan | Ukuran | Sumber angka |
|---|---|---|
| Deteksi lintas faskes tanpa membuka identitas | Paritas deteksi mode token vs mode identitas terbuka = 100% | `npm run evaluate` |
| Tidak ada PII di zona analitik | Paparan PII di claims/fraud/ml/notify/LLM = 0 | tes zone-leak |
| Kerja verifikator lebih terarah | precision@k dan lift pada kapasitas review 1% klaim | eval-kit |
| Dampak rupiah terukur | rupiah recall dan simulasi potensi penghematan | eval-kit + simulasi |
| Siap dipakai | waktu respons POST /verify p95 < 1 detik | load test |

## 3. Pengguna
| Peran | Kebutuhan | Akses |
|---|---|---|
| Verifikator cabang | Antrian klaim berisiko, alasan yang jelas, ubah status kasus | token, skor, alasan |
| Auditor / unit anti-fraud / SPI | Investigasi lintas faskes, buka identitas bila perlu | token; buka identitas dengan alasan + kuota |
| Admin / DPO | Kelola pengguna, ambang, rotasi kunci, revoke, baca audit | konfigurasi, audit |
| Tim data/AI | Latih ulang model, ekspor eval-kit | data token, metrik |
| Faskes (opsional) | Cek mandiri klaim sebelum diajukan | klaim miliknya sendiri |

## 4. Fitur MVP (wajib ada di demo)
1. Login berperan (faskes, verifikator, auditor, admin), JWT, RBAC.
2. Unggah klaim batch CSV dengan skema kolom bergaya BPJS, validasi per baris, laporan baris gagal.
3. Tokenisasi otomatis: identitas peserta diganti pseudonim HMAC sebelum masuk zona analitik.
4. Mesin deteksi: 7 detektor aturan + Isolation Forest + model supervised dengan fitur lintas faskes, digabung noisy-OR.
5. Penjelasan per kasus: LLM yang hanya melihat token, dengan fallback templat aturan.
6. Alur kasus: BARU, DITINJAU, BUTUH_INFO, TERKONFIRMASI, DITOLAK_FALSE_POSITIVE, SELESAI. Setiap perubahan tercatat.
7. Buka identitas: hanya auditor, wajib alasan, kuota harian, tercatat di audit, opsional persetujuan kedua.
8. Revoke dan rotasi: cabut token peserta tertentu, rotasi epoch 30 hari.
9. API publik: `POST /api/v1/verify` untuk satu klaim, dokumentasi Swagger di `/docs`.
10. Dashboard ringkas: jumlah klaim, kasus per tingkat risiko, per modus, per faskes, simulasi dampak rupiah.
11. Ekspor: laporan kasus (CSV/PDF), `scores.csv` dan `truth.csv` untuk eval-kit.
12. Halaman evaluasi: metrik model, evidence card, perbandingan kecil mode tanpa/dengan SAMAR.

## 5. Di luar lingkup MVP
Integrasi langsung ke VClaim, PCare, Voltage, JKN Data Hub (dirancang lewat adaptor API, belum terhubung). KMS/HSM produksi. Analisis teks catatan medis. Aplikasi mobile.

## 6. Pemetaan ke kriteria penilaian tahap 2
| Kriteria | Bukti di SAMAR | Lokasi |
|---|---|---|
| Kreativitas & keunikan (GenAI/ML) | Pseudonimisasi dinamis sebagai enabler ML lintas faskes; model supervised + Isolation Forest; LLM yang hanya melihat token | 02, 05 |
| Model bisnis berkelanjutan | Platform internal BPJS bertahap cabang ke nasional, biaya vs potensi penghematan, modul cek mandiri faskes | 07 |
| Dampak terukur | Evidence card eval-kit, rupiah recall, simulasi penghematan dengan asumsi tertulis, PII 0% | 05, 07 |
| Presentasi & komunikasi | Naskah 10 menit mengikuti struktur juknis, demo satu alur utuh | 08 |
| Kesiapan produk | API-first, Swagger, RBAC, audit, Postgres, Docker, tes otomatis, fallback | 02, 03, 06 |

## 7. Batasan yang disampaikan terbuka
- Data sintetis. Metrik membuktikan mekanisme, bukan akurasi di data riil.
- Label fraud berasal dari generator, jadi model supervised perlu dilatih ulang dengan label hasil audit BPJS.
- Simulasi rupiah memakai asumsi yang bisa diubah, bukan klaim penghematan.
- Privacy Service masih titik terpusat. KMS/HSM dan persetujuan dua orang penuh ada di roadmap.
- "Selaras prinsip UU PDP", bukan sertifikasi.
