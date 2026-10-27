# Dokumentasi SAMAR

SAMAR (Samarkan Identitas, Perluas Deteksi) adalah sistem deteksi fraud klaim JKN lintas faskes yang bekerja di atas data terpseudonimisasi. Dokumen ini dipakai untuk membangun versi siap pilot dari prototype v2.

Healthkathon 2026 BPJS Kesehatan, tema "Detect Smarter, Protect JKN", kategori Efisiensi Risiko pada Fasilitas Kesehatan.

| No | Dokumen | Isi |
|----|---------|-----|
| 00 | [CLAUDE.md](CLAUDE.md) | Aturan kerja untuk Claude Code (salin ke root repo) |
| 01 | [01-prd.md](01-prd.md) | Masalah, pengguna, fitur, ruang lingkup, pemetaan kriteria |
| 02 | [02-arsitektur.md](02-arsitektur.md) | Layanan, zona data, alur, struktur repo |
| 03 | [03-api.md](03-api.md) + [openapi.yaml](openapi.yaml) | Kontrak API |
| 04 | [04-skema-data.md](04-skema-data.md) | Skema CSV (kolom gaya BPJS), tabel Postgres, data sintetis |
| 05 | [05-ml-evaluasi.md](05-ml-evaluasi.md) | Detektor, model, LLM, rencana evaluasi |
| 06 | [06-keamanan-privasi.md](06-keamanan-privasi.md) | Kontrol keamanan, DPIA ringkas |
| 07 | [07-model-bisnis.md](07-model-bisnis.md) | Model bisnis dan simulasi dampak |
| 08 | [08-demo-video.md](08-demo-video.md) | Skenario demo dan naskah video 10 menit |
| 09 | [09-rencana-kerja.md](09-rencana-kerja.md) | Milestone sampai 1 Nov 2026, definisi selesai |

## Status
- Sistem: siap pilot (MVP), belum terhubung ke sistem BPJS mana pun.
- Data: sintetis dengan skema kolom bergaya data sampel BPJS. Tidak memakai data riil.
- Integrasi VClaim, PCare, Voltage, JKN Data Hub: rencana, lewat API.
