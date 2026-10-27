# CHANGELOG

## T1 (27 Okt 2026)
- Tambah peran login `auditor` dan `admin` (demo-auditor, demo-admin). Sementara, reveal dan revoke masih untuk `verifier` seperti prototype; spesifikasi (reveal=auditor, revoke=admin) diterapkan di T2.
- Tambah `POST /api/claims/upload` (CSV, per-baris validasi) dan `GET /api/claims/batches/{id}`, `npm run generate-data`, layanan `db` Postgres 16 di docker-compose.
- Beda dengan spesifikasi 03-api: basis path masih `/api` (bukan `/api/v1`), JWT 2 jam (bukan 15 menit), unggah `text/csv` (bukan multipart). Diselaraskan di T2 bila perlu.

## T2 (27 Okt 2026)
Spesifikasi menang atas prototype; perubahan perilaku dan tes yang disesuaikan:
- Reveal identitas: dari `verifier` menjadi `auditor` saja. Revoke: dari `verifier` menjadi `admin`. Tes diubah: `test/e2e.test.js` (reveal dan kuota memakai token auditor, revoke memakai token admin, pembacaan audit memakai admin dengan aktor `auditor`) dan `test/privacy.core.test.js` (aktor reveal berperan `auditor`). Kekuatan assertion sama; ditambah assertion verifikator ditolak 403 untuk reveal dan revoke, serta tes baru di `test/privacy.audit.test.js` dan `test/api.v1.test.js`.
- Status kasus: `PENDING_REVIEW/CONFIRMED/DISMISSED/NEEDS_INFO` menjadi `BARU/DITINJAU/BUTUH_INFO/TERKONFIRMASI/DITOLAK_FALSE_POSITIVE/SELESAI`. Assertion `CONFIRMED` di `test/e2e.test.js` dan `test/fraud.engine.test.js` menjadi `TERKONFIRMASI`. Endpoint lama `POST /cases/{id}/review` tetap ada (memetakan keputusan ke status baru).
- Audit: log yang dibaca admin kini hanya aksi berantai hash (tanpa MINIMIZE); `GET /audit/verify` memeriksa rantai.
- Login: JWT 15 menit (`JWT_TTL_SECONDS`), basis path `/api/v1` (path `/api` tetap berlaku), `POST /claims/upload` menerima `text/csv`. Sisa beda dengan 03-api: unggahan balas 200 (bukan 202) karena diproses sinkron; tingkat risiko `MEDIUM` (bukan `MED`).
- Unggahan: `claim_ref` (FKL02) menjadi `claim_id`, sehingga mengunggah ulang file yang sama menolak baris duplikat. Status batch disimpan di store gateway.
- Ditambah: `config/column-map.json`, `config/weights.json`, layanan `ml`, `/verify`, `/docs` (Swagger), kasus (filter, PATCH, explain), dashboard, simulasi dampak, ekspor CSV dan eval-kit (zip), `web/`, `demo/fkrtl_batch_november.csv`, `npm run demo:reset`.
- Perintah `npm run migrate` dan `npm run seed` di CLAUDE.md tidak dibuat: tabel dibuat otomatis saat layanan start dan pengguna demo ada di layanan auth. Akun demo: `rs.melati`, `verifikator`, `auditor`, `admin` (kata sandi `demo-<nama>`), bukan nama di 08-demo-video.
- Dipotong (daftar boleh dipotong di 09-rencana-kerja): ekspor PDF (hanya CSV), persetujuan kedua reveal, notify webhook, modul faskes cek mandiri. Belum ada di T2: halaman evaluasi dan evidence card (T3).
- UI prototype lama (`services/gateway/public`: inspector data, tombol skenario) dihapus; endpoint demo (`/api/demo/*`) tetap ada karena dipakai tes.


## T3 (27 Okt 2026)
- `npm run evaluate` ditulis ulang: 3 seed x fraud rate 1%/3% x set standar/hard, split waktu (hari 0-119 latih, 120-179 uji), hard negatives, satu modus hold-out (`REPEAT_BILLING`), ablasi (tanpa lintas faskes, tanpa ML, tanpa aturan), bootstrap CI per pasien. Keluaran: `reports/metrics.json`, `evaluation.md`, `data-card.md`, `evalkit/{scores,truth,cases}.csv` (set hard di `evalkit-hard/`), `evidence.html` dan `evidence-hard.html` dari eval-kit. `reports/evaluation.json` lama tidak dibuat lagi; `GET /evaluation/latest` kini mengembalikan `metrics.json` dan hanya untuk auditor dan admin (sebelumnya semua pengguna login).
- Beda dari spesifikasi 03-api: `POST /impact/simulate` kini memakai `rupiah_recall` sesuai rumus 07-model-bisnis (bentuk lama `review_capacity` + `precision_at_k` tetap diterima). Ditambah `GET /impact/scenarios` (rendah, sedang, tinggi; semua berlabel asumsi), `GET /evaluation/evidence`, dan `config/pilot-cost.json` (biaya pilot Rp11,3 juta per bulan).
- Generator: parameter `span` dan `difficulty` (`hard`) di `shared/synthetic.js`; modus baru `PROCEDURE_MISMATCH` hanya di set hard (tanpa detektor aturan). Perilaku default (span 80 hari, standar) tidak berubah. `scripts/build-demo-batch.js` juga membuat `demo/fkrtl_batch_november_RS-A.csv` dan `_RS-B.csv`: akun faskes hanya boleh mengunggah baris faskesnya sendiri, sehingga berkas gabungan hanya bisa diunggah verifikator (bug alur ditemukan saat cek UI: 31 dari 40 baris ditolak).
- `services/ml/models.py` dipisah dari `app.py` (kode pelatihan dipakai bersama evaluator); `ML_TRAIN_DAYS` dapat diatur. `services/fraud/engine.js` mengekspor `mlFlags` dan `combineFlags` (perilaku tidak berubah).
- Docker: layanan `ml` terpisah (`Dockerfile.ml`) dan `ML_ENABLED=true` pada compose; `scripts/stack.js` tidak menjalankan ml lokal bila `ML_URL` diisi.
- Web: halaman Evaluasi (auditor dan admin), simulasi dampak dengan tiga skenario, daftar kasus diurutkan menurut skor dan tidak lagi menampilkan teks "null". Screenshot di `docs/screens/`.
- README ditulis ulang; blok hasil diisi otomatis dari `reports/metrics.json` oleh `npm run readme` (juga dipanggil `npm run evaluate`).
- Docker: image `ml` dibangun dan dijalankan sendiri (model siap). `docker compose up` penuh belum diuji ujung ke ujung.
