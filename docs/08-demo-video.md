# Demo dan Naskah Video

Ketentuan: maks 10 menit, rekam Zoom, unggah YouTube Unlisted, pakai template presentasi dari dashboard. Tenggat 1 Nov 2026.

## Persiapan demo
- `npm run demo:reset` : kosongkan DB, seed pengguna demo, generate data seed 42, latih model.
- Akun demo (tombol di halaman login): `rs.melati`, `verifikator`, `auditor`, `admin` (kata sandi `demo-<nama>`).
- File unggah siap: `demo/fkrtl_batch_november_RS-A.csv` dan `demo/fkrtl_batch_november_RS-B.csv` (akun faskes hanya boleh mengunggah baris faskesnya sendiri). Kasus phantom billing dan cloning lintas 2 RS lengkap setelah keduanya diunggah. `demo/fkrtl_batch_november.csv` berisi keduanya, untuk verifikator.
- Rekam layar 1920×1080, zoom browser 125%, tab lain ditutup.
- Rekam cadangan demo lebih dulu, jika live gagal pakai rekaman.

## Naskah (± 9:30)
| Waktu | Bagian | Isi | Layar |
|---|---|---|---|
| 0:00-0:40 | Perkenalan | Nama, asal kampus, tim individu, foto | Slide perkenalan |
| 0:40-1:30 | Judul & tujuan | SAMAR: deteksi fraud lintas faskes tanpa membuka identitas. Tujuan: antrian review lebih tepat, PII 0 di analitik | Slide judul |
| 1:30-2:30 | Latar belakang & dampak | Fraud lintas faskes, dilema data terbuka vs tertutup, siapa yang terdampak | Slide masalah |
| 2:30-3:30 | Alur proses | Diagram: unggah, token, deteksi, penjelasan, kasus, reveal terkontrol | Slide arsitektur |
| 3:30-7:00 | Demo | (1) Login faskes (rs.melati): layar proses unggah RS-A dengan 3 tahap tanpa skor; ulang untuk rs.kenanga (RS-B). (2) Login verifikator: beranda (antrian urut skor, kasus baru hari ini), buka kasus teratas: riwayat token di 2 RS, rawat inap tumpang tindih, penjelasan, potensi nilai dipertanyakan (estimasi) dengan tooltip rumus. Tidak ada tombol buka identitas. (3) Minta berkas ke faskes, lalu faskes membalas dengan catatan; ubah status TERKONFIRMASI atau Eskalasi ke auditor. (4) Login auditor: beranda menampilkan kasus eskalasi; buka identitas dengan alasan; log reveal sendiri. (5) Login admin: beranda (kesehatan layanan, kuota), verifikasi rantai audit. (6) Swagger: POST /verify, respons < 1 detik. (7) Dashboard dan simulasi dampak (asumsi) | Aplikasi |
| 7:00-8:30 | Fitur utama & bukti | Evidence card eval-kit (precision@k, recall nilai dipertanyakan, recall per modus), paritas deteksi, PII 0%, 22+ tes keamanan, latensi | Halaman evaluasi |
| 8:30-9:30 | Slide tambahan | Model bisnis bertahap, posisi: melengkapi Voltage/FRISTA/VIDI/SIGAP (bukan menggantikan), integrasi rencana lewat adaptor API (Voltage, VClaim, Data Hub; belum terhubung), batasan jujur, langkah pilot | Slide penutup |

## Kalimat kunci
- "SAMAR tidak memutuskan fraud. SAMAR mengurutkan klaim yang perlu dilihat lebih dulu, lengkap dengan alasannya."
- "Model melihat riwayat lintas rumah sakit, tapi tidak pernah melihat nama atau NIK."
- "Verifikator tidak pernah membuka identitas. Kalau butuh bukti ia minta berkas ke faskes; kalau butuh identitas ia eskalasi ke auditor, dan itu tercatat."
- "Angka rupiah di kasus adalah potensi nilai dipertanyakan, bukan kerugian."
- "Angka ini dari data sintetis. Ini bukti mekanisme, dan langkah berikutnya adalah pilot dengan data internal BPJS."

## Checklist sebelum unggah
- [ ] Durasi < 10 menit
- [ ] Tidak ada data riil atau data sampel resmi yang tampil
- [ ] Semua angka sama dengan `reports/metrics.json`
- [ ] Tautan YouTube Unlisted bisa dibuka dari jendela incognito
