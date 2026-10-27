# Skema Data

## Prinsip
- Kolom meniru struktur data sampel BPJS (Peserta PSTV, FKTP FKP, FKRTL FKL, Non Kapitasi PNK, Diagnosis Sekunder) agar sistem mudah dipindah ke data sampel atau data internal nanti.
- Kode yang sudah pasti dari sosialisasi: `PSTV01` id peserta, `PSTV02` id keluarga, `PSTV15` bobot, `FKP02` id kunjungan FKTP, `FKL02` id kunjungan FKRTL, `FKL47` tarif ditagih, `FKL48` tarif hasil verifikasi.
- Kolom lain memakai nama deskriptif. Sebelum dipakai dengan data resmi, petakan ke kamus data BPJS di `config/column-map.json`. Jangan menebak kode.
- Isi seluruhnya sintetis. Data sampel resmi hanya untuk Healthkathon dan tidak masuk repo.

## CSV masukan
### peserta.csv (zona pribadi, hanya untuk vault)
`PSTV01, PSTV02, nik, nama, tgl_lahir, jenis_kelamin, kab_kota, segmen, PSTV15`

### fkrtl.csv
`FKL02, PSTV01, faskes_id, jenis_faskes, kab_kota_faskes, tgl_masuk, tgl_pulang, jenis_layanan (RI/RJ), diag_utama (ICD-10), prosedur (ICD-9-CM, dipisah |), inacbg, kelas_rawat, FKL47, FKL48, faskes_perujuk`

### fktp.csv
`FKP02, PSTV01, faskes_id, tgl_kunjungan, diag_utama, jenis_kunjungan, rujukan_ke`

### pnk.csv (non kapitasi)
`id_klaim, PSTV01, faskes_id, tgl_layanan, jenis_layanan, diag_utama, tarif`

### diag_sekunder.csv
`id_kunjungan, kode_icd10`

## Tabel Postgres
Skema `vault` (hanya privacy dan auth):
- `identity(subject_id PK, nik_enc, nama_enc, tgl_lahir_enc, created_at)` kolom terenkripsi AES-256-GCM
- `token_map(token PK, subject_id, purpose, epoch, revoked_at)`
- `users(id, username, password_hash, role, faskes_id, reveal_quota_daily)`

Skema `analytics` (zona token):
- `claims(claim_id PK, level, subject_token, facility_id, admit_date, discharge_date, service_type, diag_primary, diag_secondary[], procedures[], inacbg, billed, verified, referrer_facility, batch_id)`
- `features(claim_id PK, ...fitur numerik, computed_at)`
- `scores(claim_id, detector, score, reason, model_version, created_at)`
- `cases(id PK, subject_token, claim_ids[], score, risk, modus[], status, assignee, excess_amount, explanation, explanation_source, created_at, updated_at)`
- `case_events(id, case_id, actor, from_status, to_status, note, at)`
- `batches(id, uploaded_by, level, accepted, rejected, errors jsonb, at)`

Skema `audit`:
- `audit_log(id, at, actor, role, action, target, reason, ip, hash_prev, hash)` berantai hash agar perubahan terdeteksi.

## Generator sintetis
`node scripts/generate-data --peserta 5000 --faskes 40 --months 6 --fraud-rate 0.03 --seed 42`
- Faskes: campuran FKTP, RS kelas A sampai D, beberapa kab/kota.
- Pola normal: kunjungan kronis berulang (DM, TB), rujukan wajar, LOS sesuai INA-CBGs.
- Injeksi 7 modus dengan label `modus` dan `excess_rupiah` di `truth.csv`.
- Hard negatives: pasien kronis yang memang sering kontrol, rujukan balik sah, pindah domisili.
- Hold-out: satu modus (misal repeat billing) tidak dipakai saat latih supervised, untuk uji generalisasi.
- Parameter generator dicatat di `reports/data-card.md`.
