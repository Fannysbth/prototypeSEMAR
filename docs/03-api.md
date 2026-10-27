# Spesifikasi API

Basis: `http://localhost:3000/api/v1`. Autentikasi `Authorization: Bearer <JWT>`. Format JSON. Galat: `{ "error": { "code": "...", "message": "..." } }`. Kontrak lengkap di [openapi.yaml](openapi.yaml), disajikan Swagger UI di `/docs`.

| Metode | Path | Peran | Fungsi |
|---|---|---|---|
| POST | /auth/login | semua | Masuk, dapat JWT (15 menit) |
| GET | /me | semua | Profil dan peran |
| POST | /claims/upload | faskes, verifikator | Unggah CSV (multipart). Balikan `batch_id`, jumlah diterima/ditolak |
| GET | /claims/batches/{id} | faskes, verifikator | Status batch dan baris gagal |
| POST | /verify | sistem, verifikator | Skor satu klaim secara sinkron |
| GET | /cases | verifikator, auditor | Daftar kasus. Filter: `risk`, `modus`, `status`, `faskes`, `from`, `to` |
| GET | /cases/{id} | verifikator, auditor | Detail kasus, alasan, riwayat token lintas faskes |
| PATCH | /cases/{id} | verifikator, auditor | Ubah status, catatan |
| POST | /cases/{id}/explain | verifikator, auditor | Buat ulang penjelasan (LLM atau templat) |
| POST | /cases/{id}/reveal | auditor | Buka identitas. Wajib `reason` (min 20 karakter). Kena kuota |
| POST | /tokens/revoke | admin | Cabut token peserta |
| POST | /keys/rotate | admin | Mulai epoch baru |
| GET | /dashboard/summary | verifikator, auditor, admin | Ringkasan angka |
| POST | /impact/simulate | auditor, admin | Simulasi dampak rupiah dari parameter |
| GET | /reports/cases.csv | auditor | Ekspor kasus |
| GET | /export/evalkit | admin | Unduh zip `scores.csv`, `truth.csv`, `cases.csv` |
| GET | /audit | admin | Log audit |
| GET | /health | publik | Status layanan dan model |

## POST /verify
Request:
```json
{
  "claim_id": "FKL02-000123",
  "level": "FKRTL",
  "participant_id": "PSTV01-xxxx",
  "facility_id": "RS-0012",
  "admit_date": "2025-03-02",
  "discharge_date": "2025-03-06",
  "diagnosis_primary": "J18.9",
  "procedures": ["96.04"],
  "inacbg_code": "J-4-16-I",
  "billed_amount": 8450000
}
```
`participant_id` langsung ditokenisasi di gateway; tidak diteruskan ke layanan lain.

Response:
```json
{
  "claim_id": "FKL02-000123",
  "subject_token": "tk_9f2c...",
  "score": 72,
  "risk": "HIGH",
  "case_id": "CS-2025-00041",
  "signals": [
    {"detector": "cloning", "score": 0.81, "reason": "Rawat inap tumpang tindih 3 hari di RS-0012 dan RS-0047"},
    {"detector": "ml_supervised", "score": 0.66, "reason": "6 kunjungan di 4 faskes dalam 30 hari"}
  ],
  "explanation": "…",
  "explanation_source": "llm",
  "model_version": "sup-2026.10.30",
  "latency_ms": 184
}
```

## Layanan ml (internal)
- `POST /score` body: daftar fitur ter-token, balikan `if_score`, `sup_score`, `top_features`.
- `POST /train` (admin, internal): latih ulang dari tabel `analytics.features` + label.
- `GET /model` versi, tanggal latih, metrik validasi.
