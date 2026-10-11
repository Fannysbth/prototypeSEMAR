# SAMAR — Prototipe Healthkathon 2026

**Samarkan Identitas, Perluas Deteksi.**
Arsitektur Privacy-by-Design berbasis **pseudonimisasi dinamis** sebagai *enabler* deteksi kecurangan klaim **lintas-faskes** pada layanan kesehatan JKN.
Kategori lomba: **Efisiensi Risiko pada Fasilitas Kesehatan** · modus: Cloning, Self-referral, Phantom billing, Upcoding, Unbundling, Repeat billing, Prolonged LOS.

> Seluruh data adalah **sintetis** (NIK berawalan `9999` = kode provinsi yang tidak ada). Sistem menolak NIK riil secara default (`SYNTHETIC_ONLY=true`), sesuai aturan lomba.

---

## 1. Mulai cepat (3 langkah, tanpa Docker, tanpa database)

Prasyarat: **Node.js 20 atau lebih baru** (cek: `node -v`; unduh di https://nodejs.org).

```bash
cd samar-prototype
npm install
npm start
```

Buka **http://localhost:3000**. Klik salah satu tombol akun demo di halaman login. Selesai.

- Semua layanan menyala dalam ±2 detik. Hentikan dengan **Ctrl+C**.
- Tanpa `DATABASE_URL`, data disimpan di folder `data/` (otomatis). Hapus dengan `npm run reset`.
- Secret dibuat otomatis saat pertama jalan (disimpan di `data/.secrets.json`). Tidak perlu file `.env`.
- Bentrok port? Ubah `PORT=3001 npm start` (Windows PowerShell: `$env:PORT=3001; npm start`), atau isi `.env`.

Akun demo (juga muncul sebagai tombol di halaman login):

| Peran | Username | Password |
|---|---|---|
| Faskes (4 RS) | `rs.melati`, `rs.kenanga`, `rs.cempaka`, `rs.anggrek` | `demo-melati`, `demo-kenanga`, `demo-cempaka`, `demo-anggrek` |
| Verifikator BPJS | `verifikator` | `demo-verifikator` |

## 2. Perintah

| Perintah | Fungsi |
|---|---|
| `npm start` | Menyalakan Gateway + UI + 5 microservice |
| `npm test` | 39 tes otomatis (unit + e2e dengan layanan sungguhan). ±10 detik |
| `npm run evaluate` | Evaluasi terukur baseline vs SAMAR → `reports/evaluation.md/json` (juga tampil di tab *Hasil Evaluasi*). ±20 detik |
| `npm run reset` | Hapus data lokal. `npm run reset:neon` menghapus skema `samar_*` di Neon |
| `npm run gen-secrets` | Membuat 3 secret acak untuk production |

## 3. Arsitektur

```
Browser (UI) ──► API Gateway ─────────────┬─► Auth Service        (login, JWT, peran)
 (disajikan Gateway)  JWT, validasi,      │
                      rate-limit, CSP     ├─► Privacy Service     (SATU-SATUNYA yang menerima data mentah)
                                          │     kebijakan minimisasi · token dinamis · vault AES-GCM · audit
                                          ├─► Claim Processing    (hanya token + atribut klaim)
                                          ├─► Fraud Detection     (hanya token lintas-faskes + atribut klinis)
                                          └─► Notification        (hanya petunjuk tersamar ****1234)
```

- Tiap layanan = **proses terpisah**, komunikasi lewat HTTP dengan `x-internal-key`; layanan internal hanya mendengarkan `127.0.0.1`.
- Tiap layanan memiliki **penyimpanan sendiri** (namespace/skema Postgres terpisah: `samar_privacy`, `samar_claims`, `samar_fraud`, `samar_notify`).
- **Satu kode, dua mode.** Hanya `services/gateway/pipeline.js` yang membedakan mode:
  `baseline` (payload mentah ke semua layanan) vs `proposed` (lewat Privacy Service dulu). Kode Claim/Fraud/Notification **identik** di kedua mode, sehingga selisih privasi/kinerja murni akibat lapisan SAMAR.

### Apa yang diterima tiap layanan (mode SAMAR)

| Layanan | Menerima | Tidak pernah menerima |
|---|---|---|
| Claim Processing | `patient_token`, `record_token`, `age_band`, diagnosis, tindakan, tanggal, lama rawat, nominal | NIK, nama, telepon, tgl lahir, no. RM |
| Fraud Detection | `fraud_ref` (token lintas-faskes) + atribut klinis/klaim | semua identitas langsung |
| Notification | `patient_hint` (`************1234`) + ID klaim | NIK lengkap, nama |

Kebijakan ini ditulis sebagai kode di `services/privacy/policy.js` (default-deny: field yang tidak tercantum tidak pernah diteruskan) dan bisa dilihat di UI (tab *Inspektur Data*).

## 4. Pseudonimisasi dinamis — cara kerja

```
pseudonim = HMAC( HMAC(master_key, epoch) , layanan | tujuan | subjek )
```

| Sifat | Mekanisme | Manfaat |
|---|---|---|
| **Konsisten lintas-faskes** | faskes *tidak* ikut dalam rumus | pasien yang sama → token sama di RS manapun → pencocokan Cloning/Self-referral mungkin tanpa membuka identitas |
| **Berbeda per layanan & tujuan** | `layanan` dan `tujuan` ikut dalam HMAC | token Claim Service tak bisa dipakai di Fraud Service (least privilege) |
| **Berotasi (dinamis)** | kunci per-`epoch` (default 30 hari) | token kedaluwarsa & berganti otomatis; kebocoran satu epoch tidak membuka epoch lain |
| **Vault terenkripsi** | identitas asli disimpan AES-256-GCM (kunci turunan HKDF) | dump database tidak membuka NIK |
| **Audit tanpa PII** | log hanya memuat `subject_ref` (HMAC), bukan NIK | audit aman dibagikan |
| **Re-identifikasi terkontrol** | peran `verifier` + layanan & tujuan **persis sama** + belum kedaluwarsa/dicabut + alasan ≥20 karakter + nomor kasus + **kuota/jam** | mencegah pembukaan massal oleh orang dalam; semua percobaan diaudit |
| **Hak subjek (UU PDP)** | `revoke` menghapus vault (crypto-shredding) | identitas tak bisa dibuka lagi |

## 5. Deteksi kecurangan (dapat dijelaskan + human-in-the-loop)

| Modus | Sinyal (hanya token + atribut klinis) |
|---|---|
| Self-referral | token yang sama di ≥2 faskes dalam 7 hari (≥3 = risiko tinggi) |
| Phantom billing | periode layanan tumpang-tindih di dua faskes (mustahil fisik) |
| Cloning | ≥3 klaim identik (dx, tindakan, lama rawat, nominal) dari pasien berbeda di satu faskes |
| Upcoding | nominal vs referensi per diagnosis (rasio & robust z-score median/MAD) |
| Unbundling | klaim kecil berulang yang jumlahnya = satu paket |
| Repeat billing | klaim identik ditagih ulang ≤30 hari |
| Prolonged LOS | lama rawat melebihi batas wajar diagnosis |
| + **Isolation Forest** | ML tanpa label (karena label fraud tidak tersedia) pada 7 fitur non-identitas; pelengkap untuk pola tak dikenal |

Skor akhir = *noisy-OR* seluruh sinyal → `NONE/LOW/MEDIUM/HIGH`. Skor ≥45 membuat **kasus**; setiap kasus menampilkan alasan + bukti. Sistem **hanya memberi sinyal**; keputusan (terkonfirmasi / bukan fraud / butuh info) ada pada verifikator.

## 6. Memakai Neon (opsional)

Database **tidak wajib**. Pakai Neon bila ingin data tetap ada saat deploy.

1. Buat project di https://neon.tech → buka **Connection Details** → salin connection string (`postgresql://...?sslmode=require`).
2. Salin `.env.example` menjadi `.env`, isi `DATABASE_URL=<connection string>`.
3. `npm start`. Terminal akan menampilkan `Penyimpanan : POSTGRES / NEON`.

Tabel dibuat otomatis (tidak perlu menjalankan SQL). Kamu akan melihat skema `samar_privacy`, `samar_claims`, `samar_fraud`, `samar_notify` di Neon. Koneksi pertama ke Neon yang sedang "tidur" bisa butuh beberapa detik (sudah ada retry otomatis). Kosongkan `DATABASE_URL` untuk kembali ke mode tanpa database.

> Adapter Postgres diuji terhadap Postgres sungguhan (tes store + tes e2e penuh), tetapi **tidak** diuji langsung ke akun Neon milikmu karena tidak ada akses ke sana dari lingkungan pengembangan.

## 7. Deploy

### Railway (disarankan: satu service)
Launcher menjalankan semua layanan di satu kontainer; hanya Gateway yang terbuka ke publik.

1. Push folder ini ke GitHub → Railway **New Project → Deploy from GitHub repo**.
2. Tab **Variables**:

| Variable | Nilai |
|---|---|
| `NODE_ENV` | `production` |
| `DEMO_MODE` | `true` (agar akun demo & skenario aktif untuk juri); hapus untuk mode ketat |
| `JWT_SECRET`, `HMAC_MASTER_KEY`, `INTERNAL_API_KEY` | hasil `npm run gen-secrets` (simpan `HMAC_MASTER_KEY`: mengganti nilainya membuat token lama tak bisa dibuka) |
| `DATABASE_URL` | connection string Neon (disarankan; tanpa ini data hilang saat redeploy) |
| `TRUST_PROXY` | `1` |

3. **Settings → Networking → Generate Domain**. Railway otomatis menjalankan `npm start` dan mengisi `PORT`.
4. UI disajikan Gateway yang sama, jadi **tidak perlu Vercel**. Bila tetap ingin UI di Vercel: deploy folder `services/gateway/public`, isi `window.SAMAR_API_BASE` di `config.js` dengan URL Gateway, dan set `ALLOWED_ORIGIN` di Railway ke domain Vercel.

### Docker (opsional)
`docker compose up --build` → http://localhost:3000. *(Dockerfile standar; tidak dapat dijalankan di lingkungan pengembangan ini karena tidak ada Docker, jadi belum saya uji.)*

### Mode production ketat
Tanpa `DEMO_MODE`: akun demo, skenario, Inspektur, dan mode baseline **mati**; semua secret wajib; pengguna dari `AUTH_USERS_JSON` (lihat `.env.example`). Sudah diuji (boot gagal bila secret kosong; endpoint demo 404; baseline 403).

## 8. Konfigurasi

Lihat `.env.example` (semua variabel terdokumentasi). Yang paling sering dipakai: `DATABASE_URL`, `PORT`, `DEMO_MODE`, `TOKEN_TTL_SECONDS`, `REIDENTIFY_MAX_PER_HOUR`.

## 9. Yang perlu kamu periksa/ubah

- [ ] **Sebelum demo:** `npm test` hijau, `npm run evaluate` dijalankan di laptopmu sendiri (angka kinerja bergantung perangkat; laporan contoh di `reports/` dibuat di mesin 1-CPU).
- [ ] **Sebelum deploy publik:** secret baru dari `npm run gen-secrets`; `DATABASE_URL` Neon; `TRUST_PROXY=1`.
- [ ] **Nama tim & profil** diisi di slide (bukan di kode).
- [ ] **Jangan** mengisi `SYNTHETIC_ONLY=false` atau memasukkan data peserta JKN riil.
- [ ] Akun demo hanya untuk demo. Untuk penggunaan lain, isi `AUTH_USERS_JSON` dan matikan `DEMO_MODE`.

## 10. Batasan (sebut jujur ke juri)

- **Data sintetis.** Angka deteksi (precision/recall 100%) berasal dari data yang dibangkitkan dengan pola yang dikenal detektor: itu membuktikan **mekanisme dan paritas** baseline vs SAMAR, **bukan** akurasi pada data JKN riil. Tarif referensi bersifat ilustratif, bukan INA-CBG.
- **Isolation Forest dilatih pada data normal sintetis** saat start; di produksi harus dilatih ulang pada riwayat klaim ber-token nyata.
- **Linkability token dibatasi epoch.** Pencocokan lintas-faskes hanya berlaku dalam satu epoch (default 30 hari); rotasi memutus tautan lintas epoch (ini disengaja: trade-off privasi vs jangkauan analitik).
- **Overhead nyata:** SAMAR menambah satu hop ke Privacy Service per klaim (pada pengukuran lokal +4 s.d. +6 ms p95; throughput turun 35–40% pada beban uji; bervariasi antar-run). Dengan Neon, latensi absolut kedua mode naik.
- **Skala:** satu instance per layanan; kunci per-pasien (mutex) bersifat in-process. Untuk skala horizontal perlu antrean/advisory lock Postgres. Pemecahan layanan ke host terpisah didukung via `*_URL` + `INTERNAL_HOST` tetapi **belum diuji** multi-host.
- **Privacy Service adalah titik terpusat** (single point of failure & target bernilai tinggi). Mitigasi di prototipe: vault terenkripsi, kuota, audit; roadmap: HSM/KMS, replikasi, persetujuan dua-orang (dual control) untuk re-identifikasi.
- Tidak mencakup Reconciliation Service, integrasi nyata dengan SATUSEHAT/VClaim/INA-CBG, maupun sertifikasi keamanan.

## 11. Struktur folder

```
shared/          config, logger (redaksi PII), http helper, store (memory/file/postgres), data sintetis, referensi
services/
  gateway/       API + UI (public/), pipeline baseline/proposed, skema validasi, simulasi
  privacy/       policy.js (kebijakan), core.js (token, vault, re-identifikasi), index.js (HTTP)
  fraud/         detectors.js, engine.js, iforest.js (Isolation Forest), index.js
  claims/ notify/ auth/
scripts/         dev.js (launcher), stack.js, evaluate.js, reset.js, gen-secrets.js, run-tests.js
test/            store, privacy.core, fraud.engine, e2e
reports/         evaluation.md/json (contoh hasil)
docs/            PANDUAN-DEMO.md, PEMETAAN-KRITERIA.md
```

## 12. Troubleshooting

| Gejala | Solusi |
|---|---|
| `Node.js ... terlalu lama` | Pasang Node 20+ dari nodejs.org |
| `Port 3000 sudah dipakai` | `PORT=3001 npm start` (PowerShell: `$env:PORT=3001; npm start`) |
| Port internal bentrok (4101-4105) | Ubah `AUTH_PORT`, `PRIVACY_PORT`, dst. di `.env` |
| Layanan "berhenti saat start" | Baca log di atas pesan itu; biasanya port bentrok atau `DATABASE_URL` salah |
| Koneksi Neon lambat saat pertama | Normal (database tidur). Tunggu beberapa detik; ada retry otomatis |
| `Environment wajib belum diisi untuk production` | Isi 3 secret: `npm run gen-secrets` |
| Login 429 | Terlalu banyak login gagal; tunggu 1 menit |
| Data lama mengganggu demo | `npm run reset` |
| Tab *Hasil Evaluasi* kosong | Jalankan `npm run evaluate` lalu muat ulang |
