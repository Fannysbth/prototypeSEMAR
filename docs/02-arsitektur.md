# Arsitektur

## Layanan
| Layanan | Port | Zona | Tugas |
|---|---|---|---|
| gateway | 3000 | pribadi | Login, RBAC, unggah CSV, sajikan frontend dan `/docs` |
| auth | 4101 | pribadi | Pengguna, peran, JWT, kuota buka identitas |
| privacy | 4102 | pribadi | HMAC pseudonim, epoch, revoke, vault identitas |
| claims | 4103 | token | Simpan klaim ter-token, fitur lintas faskes |
| fraud | 4104 | token | 7 detektor, gabung skor, kasus, penjelasan |
| notify | 4105 | token | Notifikasi kasus ke verifikator (in-app, webhook) |
| ml | 4106 | token | FastAPI + scikit-learn: Isolation Forest, model supervised |
| db | 5432 | dipisah per skema | Postgres 16: skema `vault` (pribadi) dan `analytics` (token) |

Layanan zona token tidak punya kredensial ke skema `vault`.

## Rumus pseudonim
```
kunci_epoch = HMAC(MASTER_KEY, epoch)            # epoch = 30 hari
pseudonim   = HMAC(kunci_epoch, layanan | tujuan | id_peserta)
```
Faskes tidak masuk rumus, sehingga peserta yang sama punya token sama di semua faskes untuk tujuan yang sama. Tujuan berbeda (misal `fraud` vs `notify`) menghasilkan token berbeda. Revoke menandai token di daftar cabut; klaim baru dengan token itu ditolak dari analitik.

## Alur utama
```
CSV klaim -> gateway (validasi, RBAC)
          -> privacy (ganti PSTV01/PSTV02/NIK dengan token, simpan pemetaan di vault)
          -> claims (simpan, hitung fitur lintas faskes)
          -> fraud (7 detektor) + ml (/score) -> noisy-OR -> kasus jika skor >= 45
          -> LLM penjelasan (hanya token) atau templat
          -> notify -> dashboard verifikator
Auditor -> POST /cases/{id}/reveal (alasan, kuota) -> privacy -> audit_log
```

## Mode evaluasi
`MODE=baseline` (identitas terbuka di zona analitik) dan `MODE=proposed` (token). Hanya dipakai di halaman evaluasi untuk membuktikan paritas deteksi dan paparan PII. Produksi selalu `proposed`.

## Struktur repo (target)
```
services/{gateway,auth,privacy,claims,fraud,notify}/   Node.js
services/ml/                                           Python FastAPI
web/                                                   frontend tipis
db/migrations/  db/seed/
scripts/generate-data/  scripts/evaluate/  scripts/export-evalkit/
tests/{unit,integration,security}/
reports/                                               keluaran evaluate (di-ignore kecuali contoh)
docs/
docker-compose.yml  .env.example  CLAUDE.md
```

## Integrasi (rencana, belum terhubung)
Adaptor per sistem di `services/claims/adapters/`: `csv` (aktif), `vclaim`, `pcare`, `voltage` (tokenisasi BPJS menggantikan privacy lokal), `datahub`. Masing-masing berupa antarmuka dengan stub dan tes kontrak.

## Keputusan
- Postgres sebagai basis data default karena multi-pengguna, audit, dan transaksi kasus.
- ML dipisah ke Python karena ekosistem scikit-learn dan selaras pola pipeline FastAPI BPJS. Jika ml mati, fraud tetap jalan dengan detektor aturan (skor ML = 0, ditandai di kasus).
- Ambang kasus 45 (LOW >= 20, MED >= 45, HIGH >= 70) dapat diubah admin dan tercatat di audit.

**T1 (27 Okt 2026).** Penyimpanan tetap memakai penyimpan dokumen JSONB prototype (`shared/store.js`, satu skema Postgres per layanan: `samar_privacy` = zona pribadi, `samar_claims/fraud/notify` = zona token) alih-alih tabel relasional `vault`/`analytics` di 04-skema-data; pemisahan zona sudah ditegakkan lewat pemisahan layanan dan dibuktikan tes zone-leak. Tabel relasional, kredensial DB terpisah per zona, dan `audit_log` berantai hash belum dibuat. CSV unggahan memakai kolom klaim prototype (`facility_id,patient_nik,patient_name,phone,birth_date,record_number,diagnosis_code,procedure_code,claim_type,admit_date,length_of_stay,amount`), bukan kolom bergaya BPJS (PSTV01/FKL02), dikirim sebagai body `text/csv` (bukan multipart, agar tanpa dependensi baru) ke `POST /api/claims/upload`; status batch disimpan di memori gateway (hilang saat restart). Peran `auditor` dan `admin` sudah bisa login; hak aksinya (reveal hanya auditor, revoke admin) diterapkan di T2.

