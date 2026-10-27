# CHANGELOG

## T1 (27 Okt 2026)
- Tambah peran login `auditor` dan `admin` (demo-auditor, demo-admin). Sementara, reveal dan revoke masih untuk `verifier` seperti prototype; spesifikasi (reveal=auditor, revoke=admin) diterapkan di T2.
- Tambah `POST /api/claims/upload` (CSV, per-baris validasi) dan `GET /api/claims/batches/{id}`, `npm run generate-data`, layanan `db` Postgres 16 di docker-compose.
- Beda dengan spesifikasi 03-api: basis path masih `/api` (bukan `/api/v1`), JWT 2 jam (bukan 15 menit), unggah `text/csv` (bukan multipart). Diselaraskan di T2 bila perlu.
