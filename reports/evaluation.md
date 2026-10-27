# Laporan Evaluasi SAMAR

Dibuat 2026-10-27T12:07:32.600Z · Node v24.12.0 · win32 x64 · 16 CPU. Seluruh angka di berkas ini berasal dari `reports/metrics.json` (keluaran `npm run evaluate`).

## Batas yang harus dibaca lebih dulu
- Seluruh data sintetis. Label berasal dari generator, bukan hasil audit BPJS. Angka membuktikan mekanisme, bukan akurasi pada data JKN riil.
- Generator dan detektor ditulis oleh pihak yang sama (satu tim); detektor aturan dirancang untuk pola yang sama dengan generator. Hasil pada set standar cenderung terlalu optimistis; set hard dibuat untuk mengurangi, bukan menghilangkan, bias itu.
- Kapasitas review 1% klaim adalah asumsi, bukan data kapasitas verifikator BPJS. Pada fraud rate 3% recall@1% dibatasi kapasitas, bukan kualitas model.
- Jumlah klaim fraud di set uji kecil (puluhan per run), sehingga selang kepercayaan lebar; recall per modus dan modus hold-out dihitung dari gabungan 6 run dan tetap berbasis puluhan kasus.
- Latensi dan throughput diukur di satu mesin dengan penyimpanan memori dan tanpa LLM eksternal; angka absolut bergantung perangkat.
- Tarif referensi per diagnosis ilustratif, bukan INA-CBG resmi. Estimasi rupiah berlebih adalah estimasi generator, bukan angka audit.

## 1. Protokol
- Generator sintetis dengan 3 seed (42, 43, 44) x fraud rate 1% dan 3% x 2 tingkat kesulitan (standar, hard) = 12 run, 4000 peserta per run.
- Split waktu: hari 0-119 (bulan 1-4) melatih model; hari 120-179 (bulan 5-6) menguji. Tidak ada pengacakan.
- Modus hold-out: REPEAT_BILLING, dikeluarkan dari pelatihan model supervised dan dilaporkan terpisah.
- Hard negatives: pasien kronis kontrol rutin; pada set hard ditambah rujukan sah cepat dan kasus berat sah.
- Kapasitas review 1% klaim uji (asumsi). Dengan fraud rate 3%, recall@1% tidak mungkin melebihi sekitar sepertiga; karena itu recall@3% dan recall pada ambang kasus (skor >= 45) ikut dilaporkan.
- Selang kepercayaan 95%: bootstrap 200 resampling per pasien. Angka ringkasan = rerata (min - maks) antar 6 run.

## 2. Hasil deteksi, set standar
| Varian | precision@1% | recall@1% | lift@1% | rupiah recall@1% | PR-AUC | ROC-AUC |
|---|---|---|---|---|---|---|
| SAMAR lengkap | 87.0% (60.0% - 100.0%) | 69.4% (37.5% - 100.0%) | 67.5x (37.5x - 98.0x) | 75.7% (45.4% - 100.0%) | 1.000 (1.000 - 1.000) | 1.000 (1.000 - 1.000) |
| Tanpa ML (aturan saja) | 87.0% (60.0% - 100.0%) | 69.4% (37.5% - 100.0%) | 67.5x (37.5x - 98.0x) | 75.7% (45.6% - 100.0%) | 1.000 (1.000 - 1.000) | 1.000 (1.000 - 1.000) |
| Tanpa aturan (ML saja) | 81.3% (47.6% - 100.0%) | 61.8% (37.5% - 91.7%) | 60.1x (37.5x - 89.8x) | 59.8% (24.6% - 96.3%) | 0.857 (0.771 - 0.918) | 0.926 (0.880 - 0.957) |
| Tanpa fitur lintas faskes | 76.3% (40.0% - 100.0%) | 54.8% (37.5% - 71.4%) | 53.3x (37.5x - 68.8x) | 67.9% (43.4% - 96.7%) | 0.672 (0.598 - 0.716) | 0.843 (0.831 - 0.856) |

Set standar memakai pola fraud yang mirip dengan yang dikenal detektor. PR-AUC rata-rata >= 0,95: ini dibaca sebagai bukti mekanisme (pola fraud di generator dan detektor sejalan), bukan akurasi pada data nyata. Lihat set hard.

## 3. Hasil deteksi, set hard (skenario lebih sulit)
| Varian | precision@1% | recall@1% | lift@1% | rupiah recall@1% | PR-AUC | ROC-AUC |
|---|---|---|---|---|---|---|
| SAMAR lengkap | 83.8% (47.6% - 100.0%) | 57.4% (33.3% - 85.0%) | 55.9x (32.7x - 82.3x) | 54.8% (23.8% - 85.1%) | 0.786 (0.629 - 0.901) | 0.914 (0.858 - 0.974) |
| Tanpa ML (aturan saja) | 70.9% (38.1% - 95.2%) | 46.7% (29.3% - 75.0%) | 45.4x (28.1x - 72.6x) | 45.6% (26.4% - 73.5%) | 0.553 (0.401 - 0.705) | 0.787 (0.704 - 0.874) |
| Tanpa aturan (ML saja) | 82.2% (47.6% - 100.0%) | 56.9% (30.2% - 85.0%) | 55.4x (29.6x - 82.3x) | 51.9% (19.1% - 85.1%) | 0.733 (0.473 - 0.838) | 0.906 (0.857 - 0.948) |
| Tanpa fitur lintas faskes | 75.6% (38.1% - 100.0%) | 48.5% (33.3% - 66.7%) | 47.3x (32.7x - 64.7x) | 45.2% (24.0% - 68.7%) | 0.561 (0.463 - 0.665) | 0.773 (0.715 - 0.832) |

Set hard: upcoding hanya 1,15-1,5x, cloning tersebar 12 hari, unbundling dan self-referral dekat batas jendela, klaim ulang di luar jendela 30 hari, perawatan sedikit di atas batas wajar, satu modus tanpa detektor aturan (PROCEDURE_MISMATCH), serta hard negatives tambahan.

## 4. Ablasi
Selisih terhadap SAMAR lengkap (rerata antar run), set hard:
| Varian | PR-AUC | selisih | rupiah recall@1% | selisih |
|---|---|---|---|---|
| SAMAR lengkap | 0.786 (0.629 - 0.901) | - | 54.8% (23.8% - 85.1%) | - |
| Tanpa ML (aturan saja) | 0.553 (0.401 - 0.705) | -0.234 | 45.6% (26.4% - 73.5%) | -9.1% |
| Tanpa aturan (ML saja) | 0.733 (0.473 - 0.838) | -0.053 | 51.9% (19.1% - 85.1%) | -2.8% |
| Tanpa fitur lintas faskes | 0.561 (0.463 - 0.665) | -0.225 | 45.2% (24.0% - 68.7%) | -9.6% |

Set standar:
| Varian | PR-AUC | selisih | rupiah recall@1% | selisih |
|---|---|---|---|---|
| SAMAR lengkap | 1.000 (1.000 - 1.000) | - | 75.7% (45.4% - 100.0%) | - |
| Tanpa ML (aturan saja) | 1.000 (1.000 - 1.000) | 0.000 | 75.7% (45.6% - 100.0%) | -0.0% |
| Tanpa aturan (ML saja) | 0.857 (0.771 - 0.918) | -0.143 | 59.8% (24.6% - 96.3%) | -15.9% |
| Tanpa fitur lintas faskes | 0.672 (0.598 - 0.716) | -0.328 | 67.9% (43.4% - 96.7%) | -7.8% |

"Tanpa fitur lintas faskes" membatasi riwayat token ke faskes yang sama (meniru sistem tanpa token lintas faskes), lalu detektor dan model dilatih ulang dengan fitur itu.

## 5. Recall per modus (ambang kasus, skor >= 45; gabungan semua run, CI Wilson 95%)
Set standar:
| Modus | Klaim uji (gabungan) | SAMAR lengkap | Tanpa ML (aturan saja) | Tanpa aturan (ML saja) | Tanpa fitur lintas faskes |
|---|---|---|---|---|---|
| SELF_REFERRAL | 38 | 100.0% [90.8% - 100.0%] | 100.0% [90.8% - 100.0%] | 100.0% [90.8% - 100.0%] | 0.0% [0.0% - 9.2%] |
| PHANTOM_BILLING | 24 | 100.0% [86.2% - 100.0%] | 100.0% [86.2% - 100.0%] | 100.0% [86.2% - 100.0%] | 0.0% [0.0% - 13.8%] |
| CLONING | 30 | 100.0% [88.6% - 100.0%] | 100.0% [88.6% - 100.0%] | 100.0% [88.6% - 100.0%] | 100.0% [88.6% - 100.0%] |
| UPCODING | 40 | 100.0% [91.2% - 100.0%] | 100.0% [91.2% - 100.0%] | 100.0% [91.2% - 100.0%] | 100.0% [91.2% - 100.0%] |
| UNBUNDLING | 22 | 100.0% [85.1% - 100.0%] | 100.0% [85.1% - 100.0%] | 95.5% [78.2% - 99.2%] | 100.0% [85.1% - 100.0%] |
| REPEAT_BILLING (hold-out) | 27 | 100.0% [87.5% - 100.0%] | 100.0% [87.5% - 100.0%] | 0.0% [0.0% - 12.5%] | 100.0% [87.5% - 100.0%] |
| PROLONGED_LOS | 19 | 100.0% [83.2% - 100.0%] | 100.0% [83.2% - 100.0%] | 100.0% [83.2% - 100.0%] | 100.0% [83.2% - 100.0%] |

Set hard:
| Modus | Klaim uji (gabungan) | SAMAR lengkap | Tanpa ML (aturan saja) | Tanpa aturan (ML saja) | Tanpa fitur lintas faskes |
|---|---|---|---|---|---|
| SELF_REFERRAL | 48 | 100.0% [92.6% - 100.0%] | 100.0% [92.6% - 100.0%] | 72.9% [59.0% - 83.4%] | 2.1% [0.4% - 10.9%] |
| PHANTOM_BILLING | 25 | 100.0% [86.7% - 100.0%] | 100.0% [86.7% - 100.0%] | 100.0% [86.7% - 100.0%] | 0.0% [0.0% - 13.3%] |
| CLONING | 21 | 100.0% [84.5% - 100.0%] | 100.0% [84.5% - 100.0%] | 100.0% [84.5% - 100.0%] | 100.0% [84.5% - 100.0%] |
| UPCODING | 24 | 91.7% [74.2% - 97.7%] | 37.5% [21.2% - 57.3%] | 91.7% [74.2% - 97.7%] | 91.7% [74.2% - 97.7%] |
| UNBUNDLING | 30 | 100.0% [88.6% - 100.0%] | 0.0% [0.0% - 11.3%] | 100.0% [88.6% - 100.0%] | 100.0% [88.6% - 100.0%] |
| REPEAT_BILLING (hold-out) | 37 | 0.0% [0.0% - 9.4%] | 0.0% [0.0% - 9.4%] | 0.0% [0.0% - 9.4%] | 0.0% [0.0% - 9.4%] |
| PROLONGED_LOS | 19 | 100.0% [83.2% - 100.0%] | 100.0% [83.2% - 100.0%] | 84.2% [62.4% - 94.5%] | 100.0% [83.2% - 100.0%] |
| PROCEDURE_MISMATCH | 26 | 100.0% [87.1% - 100.0%] | 0.0% [0.0% - 12.9%] | 100.0% [87.1% - 100.0%] | 100.0% [87.1% - 100.0%] |

Catatan baca: recall per modus di set hard tinggi sebagian besar karena model supervised dilatih dari label generator yang sama (distribusi sama), bukan karena sistem sudah menggeneralisasi ke fraud baru. Ukuran generalisasi yang lebih jujur adalah modus hold-out di bawah, dan hasilnya rendah.

### Modus hold-out REPEAT_BILLING
| Varian | Set standar | Set hard |
|---|---|---|
| SAMAR lengkap | 100.0% [87.5% - 100.0%] dari 27 klaim | 0.0% [0.0% - 9.4%] dari 37 klaim |
| Tanpa aturan (ML saja) | 0.0% [0.0% - 12.5%] dari 27 klaim | 0.0% [0.0% - 9.4%] dari 37 klaim |
| Tanpa fitur lintas faskes | 100.0% [87.5% - 100.0%] dari 27 klaim | 0.0% [0.0% - 9.4%] dari 37 klaim |
| Tanpa ML (aturan saja) | 100.0% [87.5% - 100.0%] dari 27 klaim | 0.0% [0.0% - 9.4%] dari 37 klaim |

Catatan baca: pada set hard klaim ulang ditagih 38 hari setelah klaim pertama, di luar jendela 30 hari detektor dan di luar jendela fitur lintas faskes (30 hari), jadi tidak ada fitur yang bisa melihatnya. Recall 0% di sana adalah celah cakupan yang memang dibuat, bukan bukti model gagal menggeneralisasi; perbaikannya memperlebar jendela dan mengukur ulang.

"Tanpa aturan (ML saja)" adalah ukuran generalisasi sebenarnya ke modus yang tidak dilihat model; pada varian lengkap, detektor aturan klaim berulang tetap menangkapnya karena aturan itu memang ada.

## 6. Hasil per run (SAMAR lengkap)
Set standar:
| Seed | Fraud rate | Klaim uji | Fraud uji | precision@1% [CI95] | recall@1% [CI95] | rupiah recall@1% [CI95] | PR-AUC [CI95] |
|---|---|---|---|---|---|---|---|
| 42 | 1% | 2028 | 13 | 61.9% [33.3% - 100.0%] | 100.0% [100.0% - 100.0%] | 100.0% [100.0% - 100.0%] | 100.0% [100.0% - 100.0%] |
| 43 | 1% | 1960 | 12 | 60.0% [25.0% - 100.0%] | 100.0% [95.2% - 100.0%] | 100.0% [98.8% - 100.0%] | 100.0% [100.0% - 100.0%] |
| 44 | 1% | 1926 | 21 | 100.0% [60.0% - 100.0%] | 95.2% [64.5% - 100.0%] | 96.2% [72.0% - 100.0%] | 100.0% [100.0% - 100.0%] |
| 42 | 3% | 2097 | 56 | 100.0% [100.0% - 100.0%] | 37.5% [29.2% - 50.0%] | 45.4% [31.1% - 60.7%] | 100.0% [100.0% - 100.0%] |
| 43 | 3% | 2018 | 49 | 100.0% [100.0% - 100.0%] | 42.9% [32.3% - 58.3%] | 57.6% [37.2% - 72.0%] | 100.0% [100.0% - 100.0%] |
| 44 | 3% | 1968 | 49 | 100.0% [100.0% - 100.0%] | 40.8% [30.3% - 57.1%] | 55.1% [37.9% - 72.9%] | 100.0% [100.0% - 100.0%] |

Set hard:
| Seed | Fraud rate | Klaim uji | Fraud uji | precision@1% [CI95] | recall@1% [CI95] | rupiah recall@1% [CI95] | PR-AUC [CI95] |
|---|---|---|---|---|---|---|---|
| 42 | 1% | 2037 | 12 | 47.6% [23.8% - 76.2%] | 83.3% [57.1% - 100.0%] | 85.1% [57.6% - 100.0%] | 76.3% [46.4% - 100.0%] |
| 43 | 1% | 1995 | 22 | 75.0% [45.0% - 85.0%] | 68.2% [44.4% - 92.3%] | 58.5% [29.4% - 89.9%] | 62.9% [41.4% - 83.5%] |
| 44 | 1% | 1936 | 20 | 85.0% [55.0% - 100.0%] | 85.0% [59.4% - 100.0%] | 81.5% [53.2% - 100.0%] | 90.1% [77.1% - 99.7%] |
| 42 | 3% | 2120 | 55 | 100.0% [100.0% - 100.0%] | 40.0% [30.6% - 55.0%] | 42.1% [28.8% - 56.3%] | 79.2% [69.6% - 88.7%] |
| 43 | 3% | 2062 | 63 | 100.0% [95.2% - 100.0%] | 33.3% [26.6% - 44.7%] | 23.8% [16.6% - 37.8%] | 82.9% [72.6% - 91.0%] |
| 44 | 3% | 2014 | 58 | 95.2% [85.7% - 100.0%] | 34.5% [27.3% - 47.7%] | 37.6% [23.4% - 53.5%] | 80.5% [69.3% - 90.4%] |

## 7. Paritas deteksi baseline vs SAMAR dan paparan data pribadi
Data: 387 klaim sintetis (70 berlabel fraud), mode baseline (tanpa tokenisasi) dan proposed (dengan tokenisasi) pada layanan nyata, layanan ml aktif.

**Paritas:** 387/387 klaim (100.0%) menghasilkan skor dan modus identik. Precision 100.0%, recall 100.0% pada ambang kasus.

| Zona / layanan | Payload (baseline) | Mengandung PII | Payload (SAMAR) | Mengandung PII |
|---|---|---|---|---|
| claims | 387 | 387 | 387 | 0 |
| fraud | 387 | 387 | 387 | 0 |
| notify | 70 | 70 | 70 | 0 |

Total payload mengandung PII di zona token: **100% (baseline) menjadi 0% (SAMAR)**. Privacy Service menerima data mentah by design (satu-satunya titik, vault terenkripsi AES-256-GCM) dan tidak dihitung sebagai layanan hilir. Layanan ml hanya menerima 11 fitur numerik.

## 8. Kinerja
| Mode | Rata-rata | p50 | p95 | p99 | Throughput | Error |
|---|---|---|---|---|---|---|
| baseline | 14.6 ms | 14.2 ms | 17.3 ms | 18.5 ms | 100.7 TPS | 0 |
| proposed | 15.5 ms | 14.8 ms | 19.2 ms | 21 ms | 104.1 TPS | 0 |

- Latensi POST /verify (SAMAR, 120 permintaan berurutan): p50 17.2 ms, **p95 22.1 ms**, maks 30.7 ms.
- Throughput unggah CSV: 1000 baris dalam 6.53 detik = **153.3 baris/detik**.
- Satu mesin, penyimpanan memori, layanan ml aktif. Latensi absolut dengan Postgres lewat jaringan lebih tinggi.

## 9. Keamanan: 23/23 percobaan tidak sah ditolak
| Skenario | Diharapkan | Hasil | Status |
|---|---|---|---|
| Akses langsung ke Privacy Service tanpa kunci antar-layanan | 401 | 401 | LULUS |
| Akses langsung ke Claim Service tanpa kunci antar-layanan | 401 | 401 | LULUS |
| Akses langsung ke Fraud Service tanpa kunci antar-layanan | 401 | 401 | LULUS |
| Kirim klaim tanpa token login | 401 | 401 | LULUS |
| JWT dimanipulasi (tanda tangan diubah) | 401 | 401 | LULUS |
| JWT dengan alg=none | 401 | 401 | LULUS |
| Faskes membuka antrean kasus verifikator | 403 | 403 | LULUS |
| Faskes mencoba membuka identitas pasien | 403 | 403 | LULUS |
| Auditor membuka identitas tanpa alasan memadai | 400 | 400 | LULUS |
| Verifikator mencoba membuka identitas (hanya auditor) | 403 | 403 | LULUS |
| Re-identifikasi dari layanan peminta yang salah | 403 | 403 | LULUS |
| Re-identifikasi dengan tujuan (purpose) yang salah | 403 | 403 | LULUS |
| Token milik Claim Service dipakai untuk akses Fraud (lintas-layanan) | 403 | 403 | LULUS |
| Peran non-verifikator meminta re-identifikasi | 403 | 403 | LULUS |
| Token kedaluwarsa (jam digeser melewati TTL) | 403 | 403 | LULUS |
| Tebak token acak 200x (brute-force pseudonim) | 0 berhasil | 0 berhasil dari 200 | LULUS |
| Pembukaan identitas massal oleh satu verifikator (kuota/jam) | 429 setelah 5 | 429 pada percobaan ke-6 | LULUS |
| Re-identifikasi setelah subjek mencabut persetujuan (UU PDP) | 403 | 403 | LULUS |
| Kirim NIK riil (bukan sintetis 9999...) | 400 | 400 | LULUS |
| Field tak dikenal / mass-assignment | 400 | 400 | LULUS |
| Injeksi SQL pada kode diagnosis | 400 | 400 | LULUS |
| Replay klaim dengan Idempotency-Key sama | 409 | 409 | LULUS |
| Brute-force password login | 429 setelah 8 gagal | 429 pada percobaan ke-9 | LULUS |
| Pembukaan identitas SAH (peran, layanan, tujuan, alasan benar) | 200 | 200 | LULUS |
| Audit log tidak memuat NIK mentah | tidak ada | tidak ada | LULUS |

## 10. Fungsional: 9/9 lulus
- [x] Semua layanan siap (/api/ready)
- [x] Login faskes & verifikator menghasilkan JWT
- [x] Klaim valid diterima & dianalisis (201)
- [x] Kasus berisiko masuk antrean verifikator
- [x] Review verifikator mengubah status kasus (human-in-the-loop)
- [x] Ringkasan statistik tersedia
- [x] Notifikasi terkirim ke kotak masuk verifikator
- [x] Pembukaan identitas sah oleh auditor berhasil (teraudit)
- [x] Mode baseline (pembanding) berjalan pada seluruh dataset

## 11. Evidence card eval-kit
Dibuat dengan `python -m hkeval evaluate ... --capacity 0.01 --strata level,region --data-source synthetic` pada run seed 42, fraud rate 3%, set standar (`reports/evidence.html`) dan set hard (`reports/evidence-hard.html`).

Konteks: kit menghitung recall@k per modus pada run seed 42, fraud rate 3% (21 klaim ditandai untuk 56 klaim fraud di set uji, kapasitas 1%). Recall@k per modus tidak mungkin tinggi karena kapasitas lebih kecil dari jumlah fraud; butir "Lemah" di bawah sebagian besar mencerminkan batas kapasitas itu dan tidak boleh dibaca sebagai recall pada ambang kasus (bagian 5).

Temuan keterbatasan otomatis dari kit (apa adanya), set standar:
- Data sintetis; kinerja pada klaim nyata belum diukur.
- Lemah pada CLONING (recall@k di bawah 0,30).
- Lemah pada PROLONGED_LOS (recall@k di bawah 0,30).
- Lemah pada REPEAT_BILLING (recall@k di bawah 0,30).
- Lemah pada SELF_REFERRAL (recall@k di bawah 0,30).
- Lemah pada UNBUNDLING (recall@k di bawah 0,30).

Set hard:
- Data sintetis; kinerja pada klaim nyata belum diukur.
- Lemah pada PROCEDURE_MISMATCH (recall@k di bawah 0,30).
- Lemah pada REPEAT_BILLING (recall@k di bawah 0,30).
- Lemah pada UNBUNDLING (recall@k di bawah 0,30).

## 12. Simulasi dampak
Masukan skenario rupiah recall: rendah 23.8%, sedang 54.8%, tinggi 85.1% (rupiah recall @1% kapasitas, varian SAMAR lengkap, set uji hard, min/rerata/maks atas 6 run). Fraud rate, recovery rate, dan nilai klaim cabang adalah asumsi; hasil ada di halaman Evaluasi dan `GET /impact/scenarios`.
