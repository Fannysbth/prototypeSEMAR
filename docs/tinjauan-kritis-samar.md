# Tinjauan kritis SAMAR

## 1. Jawaban atas pertanyaanmu

**Unggah CSV terasa tidak terjadi apa-apa.** Kamu benar, ini kelemahan UI. Setelah unggah harus ada layar proses yang menunjukkan: berkas diterima, berapa baris valid dan gagal (beserta alasannya), identitas diganti token, deteksi berjalan, berapa kasus baru muncul. Sistem nyata selalu menampilkan status batch dan riwayatnya.

**Itu rupiah kerugian?** Bukan. Itu "nilai klaim yang dipertanyakan", yaitu estimasi selisih atau nilai klaim yang tampak tidak wajar menurut aturan. Contoh: pada kasus klaim ganda, nilainya adalah tagihan klaim yang kedua. Pada upcoding, selisih tagihan terhadap median tarif kelompok INA-CBGs yang sama. Di data sintetis nilainya berasal dari generator. Nilai ini baru menjadi kerugian jika kasus terkonfirmasi dan klaim benar-benar ditahan atau ditagih kembali. Karena itu UI harus memakai istilah "potensi nilai dipertanyakan (estimasi)", dan simulasi dampak selalu berlabel asumsi.

**Bu Sari menilai manual?** Ya, ini human-in-the-loop yang memang disengaja. Sistem hanya memberi prioritas dan alasan. Keputusan "false positive" diambil verifikator setelah memeriksa bukti.

**Kalau Bu Sari minta data asli, apakah sama saja dengan melihat data asli?** Ini poin terpenting dan jawabannya: ya, jika verifikator boleh membuka identitas, nilai privasinya hilang. Karena itu desain harus dipisah:
- Verifikator **tidak punya** tombol buka identitas. Ia menilai dari pola (token, faskes, tanggal, diagnosis, tarif), yang sudah cukup untuk menilai kejanggalan.
- Kalau butuh bukti, ia **meminta berkas ke faskes lewat nomor klaim** (faskes tahu pasiennya, SAMAR tidak perlu membuka identitas). Faskes mengunggah berkas pendukung atau tanggapan.
- Kalau butuh identitas (misal konfirmasi ke peserta atau proses hukum), kasus **dieskalasi ke auditor**. Hanya auditor yang bisa membuka identitas, dengan alasan, kuota, dan audit.
Dengan begitu identitas menjadi pengecualian yang tercatat, bukan akses harian.

**Faskes unggah data asli, verifikator hanya lihat yang disamarkan, benarkah?** Ya, itu rancangannya. Penyamaran terjadi di pintu masuk (gateway): identitas asli langsung masuk vault, yang dipakai analitik hanya token. Faskes hanya melihat data miliknya sendiri dan tidak melihat skor fraud (supaya tidak "tipping off").

**Di dunia nyata siapa yang mengirim data?** Data klaim sudah masuk ke BPJS lewat VClaim dan PCare dengan identitas asli. Jadi SAMAR realistisnya duduk di dalam BPJS sebagai lapisan pemisah: data dari sistem klaim, lalu tokenisasi, lalu analitik. Faskes mengunggah langsung ke SAMAR hanya untuk pilot atau fitur cek mandiri. Untuk demo, boleh tetap digambarkan "faskes mengirim berkas bulanan", tetapi sebutkan jalur akhirnya API dari sistem klaim BPJS.

## 2. Titik lemah yang perlu diperbaiki
1. **Klaim "belum ada solusi" berbahaya.** Dari catatan materi sosialisasi, BPJS sudah punya Voltage (tokenisasi), FRISTA, VIDI, Smart Vedika, SIGAP, AUDIA. Aku tidak menemukan materi yang menyatakan masalah ini belum punya solusi, itu bingkai dari proposal kita sendiri. Juri dari BPJS akan langsung membantah. Pakai bingkai **melengkapi**, bukan menggantikan.
2. **Voltage sudah melakukan tokenisasi.** Bedakan jelas: tokenisasi biasa menyamarkan data, SAMAR menambah token yang konsisten lintas faskes untuk satu tujuan, berbeda antar tujuan, berotasi, dan bisa dicabut, lalu memakainya untuk deteksi lintas faskes. Posisikan SAMAR sebagai lapisan yang bisa memakai Voltage sebagai mesin token (adaptor `voltage` di arsitektur).
3. **Nilai privasi bergantung pemisahan peran.** Lihat jawaban di atas. Tanpa itu juri akan bertanya hal yang sama denganmu.
4. **Jangan overclaim dampak rupiah.** Pakai "potensi", selalu dengan asumsi.
5. **Hasil hold-out REPEAT_BILLING 0%** adalah batasan jujur, tampilkan, tapi perbaiki jendela deteksi menjadi 90 hari.

## 3. Rancangan perbaikan UI/UX (tiap peran punya beranda)
| Peran | Beranda | Setelah unggah |
|---|---|---|
| Operator data / faskes | Riwayat unggahan (status, jumlah baris, gagal), kualitas data, permintaan berkas dari BPJS | Layar proses 3 langkah: Validasi, Tokenisasi, Selesai. Pratinjau 20 baris pertama, tabel baris gagal dengan alasan. Tidak ada skor fraud |
| Verifikator | Antrian kasus (urut skor), kasus baru hari ini, per modus, umur kasus, aktivitas sistem terbaru | Mendapat notifikasi "Batch X diproses, 3 kasus baru" |
| Auditor | Kasus eskalasi, permintaan buka identitas, log reveal sendiri | |
| Admin/DPO | Kesehatan sistem, log audit, kuota, rotasi kunci | |

Tambahan fitur kecil:
- **Alur pipeline** yang terlihat: Validasi, Tokenisasi, Fitur lintas faskes, Deteksi, Kasus, dengan angka tiap langkah. Ini juga bahan demo yang kuat.
- **Daftar klaim ter-token** (pratinjau seperti sistem nyata): kolom token (sebagian), faskes, tanggal, diagnosis, tarif, skor, status.
- **Minta berkas ke faskes** dari halaman kasus, dan faskes menjawab dengan unggah berkas atau catatan.
- **Eskalasi ke auditor** dari halaman kasus.
- Ganti istilah rupiah menjadi "potensi nilai dipertanyakan (estimasi)".
