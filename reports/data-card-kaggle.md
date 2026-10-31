# Data card: dataset Kaggle (klaim Medicare AS)

Dibangkitkan otomatis oleh `node scripts/import-kaggle`. Semua angka diukur dari berkas pada saat impor.

## Sumber dan lisensi
- Kaggle, "Healthcare Provider Fraud Detection Analysis" (berkas `Train_*`). Lisensi: cek halaman dataset.
- Data publik, tanpa nama atau NIK. Berkas mentah ada di `data/kaggle/` dan hasil pemetaan di `data/kaggle-mapped/`; keduanya tidak di-commit (`data/` ada di `.gitignore`).
- `BeneID` diperlakukan seperti PSTV01: wajib ditokenisasi lewat layanan privacy sebelum masuk zona token.

## Ukuran
Subset impor: 300 penyedia, stratified label, seed 42 (rawat inap 2.340 klaim, rawat jalan 29.046 klaim).

| Cakupan | Klaim | Penyedia | Penyedia berlabel fraud | Beneficiary | Beneficiary >1 penyedia |
|---|---|---|---|---|---|
| Seluruh Train | 558.211 | 5.410 | 506 (9.4%) | 138.556 | 91.653 (66.1%) |
| Subset impor | 31.386 | 300 | 28 (9.3%) | 19.613 | 1.522 (7.8%) |

Kolom terakhir penting untuk deteksi lintas faskes: hanya beneficiary dengan lebih dari satu penyedia yang bisa menghasilkan sinyal lintas faskes. Pada subset, penyedia yang tidak terpilih hilang dari riwayat beneficiary, sehingga angkanya lebih kecil daripada seluruh data.

## Pemetaan ke skema SAMAR
BeneID -> PSTV01 (PSTV02 kosong), Provider -> faskes_id, Inpatient -> RI, Outpatient -> RJ, tanggal masuk/pulang dari AdmissionDt/DischargeDt (rawat jalan: ClaimStartDt/ClaimEndDt), ClmDiagnosisCode_1 -> diag_utama (sisanya ke diag_sekunder.csv), ClmProcedureCode_1..6 -> prosedur (dipisah `|`), DiagnosisGroupCode -> inacbg, InscClaimAmtReimbursed -> FKL47 (FKL48 kosong), State-County beneficiary -> kab_kota di peserta.csv, AttendingPhysician -> kolom tambahan `attending_physician`. Gender dan DOB hanya di peserta.csv.

## Batasan
- Kode diagnosis dan prosedur adalah **ICD-9** (bukan ICD-10). Detektor yang bergantung pada tabel ICD-10 tidak berlaku penuh.
- Nilai dalam **USD**, tahun **2009**; bukan rupiah dan bukan tarif INA-CBG.
- Label `PotentialFraud` berlaku **per penyedia**, bukan per klaim. Evaluasi hanya sah di tingkat penyedia; jangan menghitung akurasi per klaim.
- `DiagnosisGroupCode` adalah DRG, padanan kasar INA-CBG. Rawat jalan tidak punya DRG.
- Tidak ada nilai verifikasi (FKL48), kelas rawat, rujukan, jenis atau lokasi faskes. Fitur berbasis kolom itu tidak tersedia.
- Beneficiary tanpa klaim di subset tidak ditulis ke peserta.csv.
- Label berasal dari kumpulan tantangan Kaggle, bukan hasil verifikasi BPJS; tidak mewakili prevalensi fraud JKN.
