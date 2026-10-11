# Laporan Evaluasi SAMAR

Dibuat: 2026-10-11T12:42:47.191Z · Node v24.12.0 · win32 x64 · 16 CPU
Data: 387 klaim sintetis (70 berlabel fraud), seed 2026. Seluruh data sintetis (NIK berawalan 9999), dibangkitkan dengan pola yang dikenal detektor; angka deteksi membuktikan MEKANISME & PARITAS baseline vs SAMAR, bukan akurasi pada data JKN riil. Tarif referensi ilustratif, bukan INA-CBG resmi.

## 1. Efektivitas deteksi (privasi naik, deteksi tidak turun)
| Mode | Precision | Recall | F1 | TP | FP | FN | TN |
|---|---|---|---|---|---|---|---|
| Tanpa SAMAR | 100.0% | 100.0% | 100.0% | 70 | 0 | 0 | 317 |
| SAMAR aktif | 100.0% | 100.0% | 100.0% | 70 | 0 | 0 | 317 |

**Paritas:** 387/387 klaim (100.0%) menghasilkan skor & modus identik di kedua mode.

| Modus | Klaim fraud | Terdeteksi | Recall |
|---|---|---|---|
| SELF_REFERRAL | 16 | 16 | 100.0% |
| PROLONGED_LOS | 6 | 6 | 100.0% |
| UNBUNDLING | 8 | 8 | 100.0% |
| PHANTOM_BILLING | 8 | 8 | 100.0% |
| CLONING | 12 | 12 | 100.0% |
| UPCODING | 12 | 12 | 100.0% |
| REPEAT_BILLING | 8 | 8 | 100.0% |

## 2. Paparan data pribadi ke layanan hilir
| Layanan | Payload (baseline) | Mengandung PII | Payload (SAMAR) | Mengandung PII |
|---|---|---|---|---|
| claims | 387 | 387 | 387 | 0 |
| fraud | 387 | 387 | 387 | 0 |
| notify | 70 | 70 | 70 | 0 |

Total payload mengandung PII asli: **100% → 0%**.

## 3. Kinerja
| Mode | Rata-rata | p50 | p95 | p99 | Throughput | Error |
|---|---|---|---|---|---|---|
| Tanpa SAMAR | 4.2 ms | 3.9 ms | 5.8 ms | 7 ms | 997.8 TPS | 0 |
| SAMAR aktif | 5.7 ms | 5.5 ms | 7.7 ms | 9.2 ms | 399.4 TPS | 0 |

Overhead: rata-rata 35.7%, p95 32.8% (+1.9 ms absolut), throughput -60.0%. Diukur pada satu mesin dengan penyimpanan memori; angka absolut bergantung perangkat. Dengan Neon/Postgres lewat jaringan, latensi absolut kedua mode lebih tinggi.

## 4. Keamanan: 22/22 percobaan tidak sah ditolak (100.0%)
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
| Verifikator membuka identitas tanpa alasan memadai | 400 | 400 | LULUS |
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

## 5. Fungsional: 9/9 lulus
- [x] Semua layanan siap (/api/ready)
- [x] Login faskes & verifikator menghasilkan JWT
- [x] Klaim valid diterima & dianalisis (201)
- [x] Kasus berisiko masuk antrean verifikator
- [x] Review verifikator mengubah status kasus (human-in-the-loop)
- [x] Ringkasan statistik tersedia
- [x] Notifikasi terkirim ke kotak masuk verifikator
- [x] Pembukaan identitas sah oleh verifikator berhasil (teraudit)
- [x] Mode baseline (pembanding) berjalan pada seluruh dataset
