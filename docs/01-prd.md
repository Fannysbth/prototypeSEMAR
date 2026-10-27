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
| Dampak nilai terukur | recall nilai dipertanyakan (rupiah recall di eval-kit) dan simulasi potensi penghematan, selalu berlabel asumsi | eval-kit + simulasi |
| Siap dipakai | waktu respons POST /verify p95 < 1 detik | load test |

## 3. Pengguna
| Peran | Kebutuhan | Akses | Beranda |
|---|---|---|---|
| Operator data / faskes | Mengirim data klaim, melihat kualitas data, menjawab permintaan berkas | data miliknya sendiri; tidak melihat skor atau kasus | Riwayat unggahan, kualitas data, permintaan berkas |
| Verifikator cabang | Menilai antrian klaim berisiko dari pola token; meminta berkas ke faskes; eskalasi | token, skor, alasan; **tidak ada** aksi buka identitas | Antrian urut skor, kasus baru hari ini, per modus, umur kasus, aktivitas sistem |
| Auditor / unit anti-fraud / SPI | Menangani kasus eskalasi; membuka identitas bila benar-benar perlu | token; buka identitas dengan alasan, kuota, dan audit | Kasus eskalasi, log reveal milik sendiri |
| Admin / DPO | Kelola pengguna, ambang, rotasi kunci, revoke, baca audit | konfigurasi, audit | Kesehatan layanan, rantai audit, kuota |
| Tim data/AI | Latih ulang model, ekspor eval-kit | data token, metrik | (halaman Evaluasi) |

Identitas adalah pengecualian yang tercatat, bukan akses harian. Jika verifikator boleh membuka identitas, nilai privasi pseudonimisasi hilang; karena itu verifikator memakai dua jalur lain di bagian 3a.

### 3a. Alur kasus tanpa membuka identitas
1. Faskes mengirim data (jalur pilot: CSV; jalur akhir: API dari sistem klaim BPJS). Layar proses menampilkan tahap. Faskes hanya melihat Validasi, Tokenisasi, Selesai.
2. Sistem membuat kasus. Verifikator menilai dari token, faskes, tanggal, diagnosis, tarif, skor, dan alasan.
3. Butuh bukti: verifikator **meminta berkas ke faskes** lewat nomor klaim (status `MENUNGGU_FASKES`). Faskes membalas dengan catatan atau berkas kecil (maks 200 KB); catatan disaring dari NIK dan nama; kasus kembali `DITINJAU`.
4. Butuh identitas (konfirmasi ke peserta, proses hukum): verifikator **eskalasi ke auditor** (status `ESKALASI`). Hanya auditor yang membuka identitas.
5. Semua langkah masuk `case_events` dan audit berantai hash.

## 4. Fitur MVP (wajib ada di demo)
1. Login berperan (faskes, verifikator, auditor, admin), JWT, RBAC.
2. Unggah klaim batch CSV dengan skema kolom bergaya BPJS, validasi per baris, laporan baris gagal.
3. Tokenisasi otomatis: identitas peserta diganti pseudonim HMAC sebelum masuk zona analitik.
4. Mesin deteksi: 7 detektor aturan + Isolation Forest + model supervised dengan fitur lintas faskes, digabung noisy-OR.
5. Penjelasan per kasus: LLM yang hanya melihat token, dengan fallback templat aturan.
6. Alur kasus: BARU, DITINJAU, BUTUH_INFO, MENUNGGU_FASKES, ESKALASI, TERKONFIRMASI, DITOLAK_FALSE_POSITIVE, SELESAI. Setiap perubahan tercatat. Verifikator: minta berkas ke faskes dan eskalasi ke auditor.
7. Buka identitas: hanya auditor, wajib alasan, kuota harian, tercatat di audit, opsional persetujuan kedua.
8. Revoke dan rotasi: cabut token peserta tertentu, rotasi epoch 30 hari.
9. API publik: `POST /api/v1/verify` untuk satu klaim, dokumentasi Swagger di `/docs`.
10. Beranda per peran, daftar klaim ter-token, dan dashboard ringkas: jumlah klaim, kasus per tingkat risiko, per modus, per faskes, simulasi dampak (asumsi). Nilai rupiah di kasus disebut "potensi nilai dipertanyakan (estimasi)", bukan kerugian.
11. Ekspor: laporan kasus (CSV/PDF), `scores.csv` dan `truth.csv` untuk eval-kit.
12. Halaman evaluasi: metrik model, evidence card, perbandingan kecil mode tanpa/dengan SAMAR.

## 4a. Istilah nilai
"Potensi nilai dipertanyakan (estimasi)" adalah estimasi nilai klaim yang tampak tidak wajar menurut aturan: klaim ganda = tagihan klaim kedua; upcoding = selisih tagihan terhadap median tarif INA-CBGs kelompok yang sama; lama rawat berlebih = porsi tagihan hari di atas rata-rata. Modus lain tidak dihitung (0). Nilai ini baru menjadi kerugian bila kasus terkonfirmasi dan klaim ditahan atau ditagih kembali.

## 4b. Posisi terhadap sistem BPJS yang ada
SAMAR melengkapi, bukan menggantikan, Voltage (tokenisasi), FRISTA, VIDI, dan SIGAP. Yang ditambahkan adalah token konsisten lintas faskes per tujuan yang berotasi dan bisa dicabut, deteksi lintas faskes di atasnya, dan pemisahan peran pada alur kasus. Integrasi lewat adaptor API (rencana, belum terhubung). Di sistem nyata data klaim berasal dari sistem klaim BPJS (VClaim, PCare); unggah CSV hanya jalur pilot.

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
