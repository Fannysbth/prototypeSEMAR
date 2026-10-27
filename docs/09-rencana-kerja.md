# Rencana Kerja (27 Okt - 1 Nov 2026)

| Tanggal | Tahap | Hasil | Selesai jika |
|---|---|---|---|
| 27-28 Okt | T1 Fondasi & data | Audit singkat prototype, Postgres, generator sintetis, unggah CSV, tokenisasi, login 4 peran | Unggah 5.000 peserta sukses, tes lama + zone-leak hijau |
| 29-30 Okt | T2 Deteksi & alur | Fitur lintas faskes, layanan ml, `/verify` + Swagger, kasus, penjelasan LLM + fallback, reveal + audit, revoke, dashboard, simulasi, ekspor | Skenario demo jalan dari awal sampai akhir |
| 31 Okt | T3 Evaluasi & rekam | `npm run evaluate`, evidence card, README, rekam video | Angka laporan konsisten, video < 10 menit |
| 1 Nov | Cadangan & submit | Perbaikan, unggah YouTube Unlisted, submit tautan | Tautan terkirim |

Jika waktu kurang, urutan yang dipotong lebih dulu: modul faskes cek mandiri, ekspor PDF (cukup CSV), persetujuan kedua reveal, notify webhook. Yang tidak boleh dipotong: tokenisasi, deteksi lintas faskes, `/verify` + Swagger, alur kasus, reveal + audit, evaluasi.

## Definisi selesai (seluruh sistem)
- `docker compose up` + `npm run demo:reset` + `npm start` berjalan di laptop bersih.
- Semua tes hijau, termasuk tes keamanan lama.
- README berisi cara jalan, arsitektur singkat, hasil evaluasi, batasan.
- Tidak ada PII di log, payload LLM, atau skema analytics.
