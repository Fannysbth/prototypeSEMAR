# Demo dan Naskah Video

Ketentuan: maks 10 menit, rekam Zoom, unggah YouTube Unlisted, pakai template presentasi dari dashboard. Tenggat 1 Nov 2026.

## Persiapan demo
- `npm run demo:reset` : kosongkan DB, seed pengguna demo, generate data seed 42, latih model.
- Akun demo (tombol di halaman login): `rs.melati`, `verifikator`, `auditor`, `admin` (kata sandi `demo-<nama>`).
- File unggah siap: `demo/fkrtl_batch_november.csv` berisi kasus cloning lintas 2 RS.
- Rekam layar 1920×1080, zoom browser 125%, tab lain ditutup.
- Rekam cadangan demo lebih dulu, jika live gagal pakai rekaman.

## Naskah (± 9:30)
| Waktu | Bagian | Isi | Layar |
|---|---|---|---|
| 0:00-0:40 | Perkenalan | Nama, asal kampus, tim individu, foto | Slide perkenalan |
| 0:40-1:30 | Judul & tujuan | SAMAR: deteksi fraud lintas faskes tanpa membuka identitas. Tujuan: antrian review lebih tepat, PII 0 di analitik | Slide judul |
| 1:30-2:30 | Latar belakang & dampak | Fraud lintas faskes, dilema data terbuka vs tertutup, siapa yang terdampak | Slide masalah |
| 2:30-3:30 | Alur proses | Diagram: unggah, token, deteksi, penjelasan, kasus, reveal terkontrol | Slide arsitektur |
| 3:30-7:00 | Demo | (1) Login faskes, unggah CSV. (2) Login verifikator, kasus HIGH muncul, buka detail: riwayat token di 2 RS, rawat inap tumpang tindih, penjelasan LLM. (3) Ubah status TERKONFIRMASI. (4) Login auditor, buka identitas dengan alasan, lihat audit. (5) Swagger: panggil POST /verify, respons < 1 detik. (6) Dashboard + simulasi dampak | Aplikasi |
| 7:00-8:30 | Fitur utama & bukti | Evidence card eval-kit (precision@k, rupiah recall, recall per modus), paritas deteksi, PII 0%, 22+ tes keamanan, latensi | Halaman evaluasi |
| 8:30-9:30 | Slide tambahan | Model bisnis bertahap, integrasi rencana (Voltage, VClaim, Data Hub), batasan jujur, langkah pilot | Slide penutup |

## Kalimat kunci
- "SAMAR tidak memutuskan fraud. SAMAR mengurutkan klaim yang perlu dilihat lebih dulu, lengkap dengan alasannya."
- "Model melihat riwayat lintas rumah sakit, tapi tidak pernah melihat nama atau NIK."
- "Angka ini dari data sintetis. Ini bukti mekanisme, dan langkah berikutnya adalah pilot dengan data internal BPJS."

## Checklist sebelum unggah
- [ ] Durasi < 10 menit
- [ ] Tidak ada data riil atau data sampel resmi yang tampil
- [ ] Semua angka sama dengan `reports/metrics.json`
- [ ] Tautan YouTube Unlisted bisa dibuka dari jendela incognito
