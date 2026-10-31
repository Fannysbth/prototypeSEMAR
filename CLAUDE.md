# CLAUDE.md

Proyek: SAMAR, sistem deteksi fraud klaim JKN lintas faskes di atas data terpseudonimisasi. Dibangun dari prototype v2 (Node.js, 6 layanan). Spesifikasi ada di `docs/`. Baca `docs/01-prd.md` dan `docs/02-arsitektur.md` sebelum mengubah kode.

## Perintah
- `docker compose up -d db` lalu `npm run migrate` dan `npm run seed`
- `npm start` menjalankan semua layanan
- `npm test` harus hijau sebelum commit
- `npm run evaluate` menghasilkan `reports/` dan ekspor eval-kit
- ML: `cd services/ml && pip install -r requirements.txt && uvicorn app:app --port 4106`

## Aturan wajib
1. Tidak ada data riil atau data pribadi asli. Sumber data yang boleh: generator sintetis (`scripts/generate-data`) dan dataset Kaggle publik di `data/kaggle/` (tidak di-commit; `BeneID` diperlakukan seperti PSTV01 dan wajib ditokenisasi lewat privacy). Data sampel resmi BPJS tidak boleh masuk repo.
2. Data pribadi (NIK, nama, tanggal lahir lengkap, alamat) hanya boleh ada di gateway, privacy, dan vault. Layanan claims, fraud, ml, notify hanya menerima token. Tes `zone-leak` harus tetap lulus.
3. LLM hanya menerima token, kode diagnosis, angka, dan alasan detektor. Jangan pernah kirim PII. Jika LLM gagal atau `LLM_API_KEY` kosong, pakai penjelasan templat aturan.
4. Rahasia lewat `.env` saja. Jangan commit `.env`, kunci, atau token.
5. Setiap aksi sensitif (buka identitas, revoke, ubah status kasus, ubah ambang) masuk `audit_log`.
6. Jangan klaim hasil yang tidak diukur. Angka di README, dashboard, dan laporan diambil dari keluaran `npm run evaluate`.
7. Sistem tidak menjatuhkan keputusan fraud. Keluaran berupa skor, alasan, dan prioritas review untuk verifikator.

## Gaya kode
- Ikuti pola prototype: Node.js >= 20, modul per layanan, tanpa framework berat. Validasi input di tepi layanan.
- Fungsi kecil, nama jelas, komentar hanya untuk alasan yang tidak terlihat dari kode.
- TDD ringkas: tulis tes yang gagal dulu untuk perilaku di jalur demo (tokenisasi, zone-leak, RBAC, reveal, /verify, detektor), lalu kode minimal sampai hijau. Jangan menulis tes untuk getter, konfigurasi, atau UI. Jangan hapus atau lewati tes yang ada.
- Frontend tipis: HTML + JS biasa atau satu SPA kecil, disajikan dari gateway.
- Teks UI dan laporan dalam Bahasa Indonesia yang lugas.

## Cara kerja
- Kerjakan per tahap (T1-T3) di `docs/09-rencana-kerja.md`. Satu tahap, tes hijau, satu commit per tahap.
- Hemat token: baca hanya file yang dibutuhkan, jangan membaca ulang file yang baru ditulis, jangan cetak keluaran panjang (potong dengan head/tail), jalankan hanya tes yang terkait lalu seluruh tes di akhir tahap.
- Jika spesifikasi bertentangan dengan kode prototype, ikuti spesifikasi dan catat di `docs/CHANGELOG.md`.
- Jika ada keputusan desain baru, tambahkan satu paragraf di `docs/02-arsitektur.md` bagian Keputusan.
