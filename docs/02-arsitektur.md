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

**T2 (27 Okt 2026).** Audit berantai hash (`seq`, `hash_prev`, `hash`) berada di Privacy Service untuk reveal, revoke, rotasi, ubah status kasus, dan ubah ambang; MINIMIZE (volume tinggi) tidak ikut rantai. Reveal hanya `auditor` dengan kuota per jam dan per hari (`REIDENTIFY_MAX_PER_HOUR`/`_PER_DAY`), revoke dan rotasi epoch hanya `admin`; klaim baru dari peserta tercabut ditolak 403 `SUBJECT_REVOKED` saat tokenisasi. Nama pasien disimpan terenkripsi di vault hanya untuk penyaring PII (`/v1/screen`) sebelum teks dikirim ke LLM. Fitur lintas faskes dihitung di Fraud Service per `fraud_ref` (bukan di Claims Service); `referral_loop` didekati dengan pola faskes A, B, A dalam 30 hari karena CSV belum memuat faskes perujuk, dan padanan INA-CBG memakai referensi per diagnosis (belum ada kode INA-CBG). Layanan `ml` (Python, port 4106) dilatih saat start dari `services/ml/data/train.csv` (dibuat `npm run demo:reset`, seed berbeda dari data demo; split waktu, modus `REPEAT_BILLING` hold-out); bila mati, Fraud Service memakai aturan saja dan kasus diberi `ml_status = unavailable`. Klaim identik dari pasien berbeda dikunci per (faskes, sidik jari klaim) agar unggahan paralel tidak melewatkan cloning. `/verify` memakai penjelasan templat (cepat); LLM hanya lewat `POST /cases/{id}/explain`. Tingkat risiko tetap `MEDIUM` (bukan `MED`) mengikuti prototype. Frontend ada di `web/` (UI prototype lama di `services/gateway/public` dihapus).


**T3 (27 Okt 2026).** Evaluasi dipisah menjadi dua bagian di `scripts/evaluate.js`: deteksi offline (`scripts/eval/offline.js`) dan pengukuran sistem nyata (`scripts/eval/stack-run.js`). Bagian offline memakai kode engine yang sama (`extractFeatures`, 7 detektor, `mlFlags`, `combineFlags`) dan kode pelatihan ml yang sama (`services/ml/models.py`), tetapi model dilatih ulang per run hanya dari klaim hari 0-119 (split waktu) sehingga tidak ada kebocoran dari bulan uji. Ablasi "tanpa fitur lintas faskes" membatasi riwayat token ke faskes yang sama lalu melatih ulang model. Set hard memakai generator yang sama dengan parameter lebih sulit dan hard negatives tambahan; klaim wajar identik antar tingkat kesulitan. Evidence card dibuat eval-kit yang di-clone di luar repo (`EVALKIT_DIR`, default `../healthkathon-eval-kit`) dan disajikan gateway untuk auditor dan admin; karena iframe tidak bisa mengirim header Authorization, `GET /evaluation/evidence` menerima token sesi lewat query `access_token`, diperiksa perannya, dan dibalas dengan CSP `sandbox`. Simulasi dampak memakai rumus `docs/07-model-bisnis.md` dengan masukan `rupiah_recall`; tiga skenario berasal dari `reports/metrics.json` dan `config/pilot-cost.json`. Layanan ml di Docker berjalan di kontainer Python terpisah (`Dockerfile.ml`); launcher tidak menjalankan ml lokal bila `ML_URL` diisi.

**Keamanan (27 Okt 2026).** Prinsip least privilege diterapkan pada rahasia, bukan hanya pada data: `shared/config.js` memuat per layanan hanya rahasia yang perlu (privacy: kunci vault; gateway dan auth: JWT; claims, fraud, notify, ml: hanya kunci antar-layanan) dan `scripts/stack.js` memangkas env proses anak. Kuota reveal dan penulisan audit diserialkan dalam satu kunci per proses. Teks LLM dianggap tidak tepercaya di kedua arah: data kasus dibungkus `<data_kasus>`, keluaran disanitasi dan disaring PII, dan hanya berupa penjelasan.

**T4 (27 Okt 2026).** Pemisahan peran ditegakkan di alur, bukan hanya di tombol: verifikator memakai `request-file` (Gateway menyimpan permintaan dan balasan di koleksi `file_requests` zona gateway, bukan di zona token) dan `escalate`; hanya auditor yang memanggil `reveal` dan mengunduh lampiran. Catatan teks disaring Privacy Service sebelum disimpan atau masuk `case_events` (NIK atau nama ditolak 400). Unggahan CSV dapat diproses di latar (`?async=true`); status batch hidup disimpan di memori gateway selama diproses lalu di store, dan proyeksinya dipilih per peran (`viewBatch`) sehingga faskes tidak pernah menerima skor atau jumlah kasus dari endpoint batch. Jendela REPEAT_BILLING 90 hari memaksa `loadContext` memuat riwayat 90 hari; fitur lintas faskes tetap 30 hari agar model dan hasil lama sebanding.
- Sumber data kedua (Kaggle): BeneID tidak pernah diteruskan mentah. Adaptor di gateway (`kaggle-adapter.js`) mengubahnya menjadi id 16 digit berawalan 9999 yang injektif, sehingga melewati tokenisasi privacy yang sama dengan NIK sintetis. Kode ICD-9, nilai USD, dan label per penyedia adalah batasan yang dicatat di `reports/data-card-kaggle.md`.
- Model ml untuk data Kaggle bekerja per penyedia karena label hanya ada per penyedia. Evaluasi memakai GroupKFold per penyedia dan skor penyedia yang dikenal adalah skor out-of-fold, supaya angka yang dilaporkan dan skor yang dipakai di kasus tidak berasal dari data latih yang sama. Penjelas LLM tetap di gateway karena penyaring PII perlu vault.
