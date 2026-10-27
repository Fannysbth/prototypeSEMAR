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

