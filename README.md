# SAMAR

Deteksi fraud klaim JKN lintas faskes di atas data terpseudonimisasi. Dibangun dari prototype v2 (Node.js, 6 layanan) untuk Healthkathon 2026.

SAMAR **tidak memutuskan fraud**. Keluarannya skor, alasan, dan prioritas review untuk verifikator. Model melihat riwayat lintas rumah sakit lewat token, dan tidak pernah melihat nama atau NIK.

> Semua data sintetis (NIK berawalan `9999`). Tidak ada data peserta JKN riil dan tidak ada data sampel resmi BPJS di repo ini. Sistem menolak NIK riil (`SYNTHETIC_ONLY=true`).

## Cara jalan

Prasyarat: Node.js 20+, Python 3.10+ (untuk layanan ml; tanpa Python sistem tetap jalan dengan detektor aturan saja).

| Langkah | Perintah |
|---|---|
| 1. Pasang dependensi Node | `npm install` |
| 2. Pasang dependensi ml | `cd services/ml && pip install -r requirements.txt` |
| 3. Siapkan data demo dan data latih model | `npm run demo:reset` |
| 4. Jalankan semua layanan | `npm start` (buka http://localhost:3000) |
| 5. Jalankan tes | `npm test` |
| 6. Jalankan evaluasi (membuat `reports/`) | `npm run evaluate` (sekitar 10-15 menit) |
| 7. Perbarui angka di README dari `reports/metrics.json` | `npm run readme` |

Akun demo (tombol di halaman login; kata sandi `demo-<nama>`): `rs.melati` (faskes RS-A; juga `rs.kenanga`, `rs.cempaka`, `rs.anggrek`), `verifikator`, `auditor`, `admin`.

Berkas unggah demo: `demo/fkrtl_batch_november_RS-A.csv` dan `demo/fkrtl_batch_november_RS-B.csv` (akun faskes hanya boleh mengunggah baris faskesnya sendiri). `demo/fkrtl_batch_november.csv` berisi keduanya dan dapat diunggah oleh verifikator. Kasus phantom billing dan cloning lintas 2 RS baru terlihat lengkap setelah kedua faskes mengunggah.

Opsi lain:
- **Postgres**: `docker compose -f docker-compose.yml -f docker-compose.hostdb.yml up -d db`, isi `DATABASE_URL` di `.env`, lalu `npm start`. Tanpa `DATABASE_URL`, data disimpan di folder `data/`.
- **Docker penuh**: jalankan `npm run demo:reset` lebih dulu (membuat `services/ml/data/train.csv` yang di-mount ke kontainer ml), lalu `docker compose up --build`. Layanan ml berjalan di kontainer Python terpisah (`Dockerfile.ml`), jadi `ML_ENABLED=true`. Jika berkas latih tidak ada, kontainer ml hidup tetapi model belum siap dan gateway memakai aturan saja.
- **Swagger**: http://localhost:3000/docs (kontrak di `docs/openapi.yaml`).

## Arsitektur singkat

```
Browser (web/) -> Gateway -+-> Auth
                           +-> Privacy (satu-satunya yang menerima data pribadi; vault AES-GCM; audit berantai hash)
                           +-> Claims  --+
                           +-> Fraud ----+-- hanya token + atribut klaim
                           |     +-> ml (Python: Isolation Forest + Gradient Boosting)
                           +-> Notify
```

- **Zona data pribadi**: gateway, privacy, vault. **Zona token**: claims, fraud, ml, notify. Tes `zone-leak` memastikan tidak ada PII yang sampai ke zona token.
- **Token** konsisten lintas faskes (faskes tidak ikut dalam rumus), berbeda per layanan dan tujuan, dan berotasi per epoch.
- **Deteksi**: 7 detektor aturan + Isolation Forest + model supervised, digabung dengan noisy-OR (`config/weights.json`). Skor >= 45 membuat kasus. Fitur lintas faskes dihitung per token (`services/fraud/engine.js`).
- **Penjelasan**: LLM hanya menerima token, kode diagnosis, angka, dan alasan detektor, setelah penyaring PII. Tanpa `LLM_API_KEY` atau saat LLM gagal, dipakai templat aturan (`explanation_source` menunjukkan sumbernya).
- **Manusia memutuskan**: status kasus, minta berkas ke faskes dan eskalasi (verifikator), reveal identitas (hanya auditor, wajib alasan, ada kuota), revoke (admin), dan ubah ambang tercatat di audit log. Verifikator tidak punya aksi reveal.
- **Nilai di kasus** disebut "potensi nilai dipertanyakan (estimasi)", bukan kerugian; rumusnya per modus ada di tooltip dan di `docs/01-prd.md`.
- Spesifikasi lengkap ada di `docs/` (mulai dari `docs/01-prd.md` dan `docs/02-arsitektur.md`).

## Hasil evaluasi

<!-- HASIL:START -->
Sumber: `reports/metrics.json` (dibuat 2026-10-27 oleh `npm run evaluate`). 3 seed x fraud rate 1%/3% x 2 tingkat kesulitan; latih bulan 1-4, uji bulan 5-6; kapasitas review 1% klaim (asumsi). Angka = rerata (min-maks) antar 6 run per tingkat.

**Set hard (skenario lebih sulit, angka utama):**

| Varian | precision@1% | recall@1% | recall nilai dipertanyakan@1% | PR-AUC | ROC-AUC |
|---|---|---|---|---|---|
| SAMAR lengkap | 86.2% (57.1% - 100.0%) | 61.0% (33.3% - 100.0%) | 58.3% (23.8% - 100.0%) | 0.922 | 0.996 |
| Tanpa ML (aturan saja) | 82.9% (47.6% - 100.0%) | 56.1% (33.3% - 83.3%) | 67.3% (51.7% - 79.7%) | 0.719 | 0.868 |
| Tanpa aturan (ML saja) | 82.2% (47.6% - 100.0%) | 56.9% (30.2% - 85.0%) | 51.9% (19.1% - 85.1%) | 0.733 | 0.906 |
| Tanpa fitur lintas faskes | 81.4% (47.6% - 100.0%) | 55.2% (33.3% - 83.3%) | 51.0% (24.0% - 83.6%) | 0.699 | 0.855 |

**Set standar (pola fraud mirip generator; cenderung optimistis):**

| Varian | precision@1% | recall@1% | recall nilai dipertanyakan@1% | PR-AUC | ROC-AUC |
|---|---|---|---|---|---|
| SAMAR lengkap | 87.0% (60.0% - 100.0%) | 69.4% (37.5% - 100.0%) | 75.7% (45.4% - 100.0%) | 1.000 | 1.000 |
| Tanpa ML (aturan saja) | 87.0% (60.0% - 100.0%) | 69.4% (37.5% - 100.0%) | 75.7% (45.6% - 100.0%) | 1.000 | 1.000 |
| Tanpa aturan (ML saja) | 81.3% (47.6% - 100.0%) | 61.8% (37.5% - 91.7%) | 59.8% (24.6% - 96.3%) | 0.857 | 0.926 |
| Tanpa fitur lintas faskes | 76.3% (40.0% - 100.0%) | 54.8% (37.5% - 71.4%) | 67.9% (43.4% - 96.7%) | 0.672 | 0.843 |

- Ablasi: baris "Tanpa fitur lintas faskes", "Tanpa ML", dan "Tanpa aturan" membandingkan kontribusi tiap komponen terhadap SAMAR lengkap.
- Modus hold-out REPEAT_BILLING (tidak dipakai melatih model supervised), recall pada ambang kasus: SAMAR lengkap 100.0% (n=27, CI95 87.5%-100.0%) (standar) dan 100.0% (n=37, CI95 90.6%-100.0%) (hard); **ML saja** 0.0% (n=27, CI95 0.0%-12.5%) (standar) dan 0.0% (n=37, CI95 0.0%-9.4%) (hard).
- Paritas deteksi baseline vs SAMAR: 387/387 klaim identik (100.0%). Payload di zona token yang memuat data pribadi: 100% menjadi 0%.
- Latensi POST /verify p95 31.6 ms; throughput unggah CSV 321 baris/detik (satu mesin, penyimpanan memori).
- Keamanan: 23/23 percobaan akses tidak sah ditolak; fungsional 9/9 lulus.
- Evidence card eval-kit: `reports/evidence.html` dan `reports/evidence-hard.html` (6 butir keterbatasan otomatis dari kit, lihat `reports/evaluation.md`).

> PR-AUC rata-rata >= 0,95: ini dibaca sebagai bukti mekanisme (pola fraud di generator dan detektor sejalan), bukan akurasi pada data nyata. Lihat set hard.

<!-- HASIL:END -->

Laporan lengkap: `reports/evaluation.md`. Kartu data: `reports/data-card.md`. Halaman *Evaluasi* di web (auditor dan admin) menampilkan metrik, ablasi, hold-out, perbandingan tanpa/dengan SAMAR, dan evidence card.

## Batasan yang jujur

- **Data sintetis, label dari generator.** Angka membuktikan mekanisme, bukan akurasi pada data JKN riil. Generator dan detektor ditulis oleh pihak yang sama; set standar cenderung optimistis. Karena itu set hard (fraud lebih halus, hard negatives tambahan, satu modus tanpa detektor aturan) ditampilkan berdampingan.
- **Kapasitas review 1% klaim adalah asumsi**, bukan kapasitas verifikator BPJS. Pada fraud rate 3% recall@1% dibatasi oleh kapasitas.
- **Recall per modus di set hard tinggi sebagian karena model supervised dilatih dari label generator yang sama.** Ukuran generalisasi yang lebih jujur adalah modus hold-out dengan **ML saja**, yang 0% (lihat blok hasil). Recall hold-out SAMAR lengkap di set hard naik dari 0% (jendela 30 hari) menjadi 100% setelah jendela REPEAT_BILLING dilebarkan ke 90 hari, tetapi kenaikan itu by construction (jarak klaim ulang dibuat generator 38 hari), bukan generalisasi; klaim ulang di luar 90 hari tetap lolos. Penjelasan di `reports/evaluation.md`.
- **Jumlah fraud di set uji kecil** (puluhan per run), sehingga selang kepercayaan lebar. Recall modus hold-out dihitung dari gabungan 6 run.
- **Simulasi dampak rupiah** memakai rupiah recall dari evaluasi dan biaya pilot dari `docs/07-model-bisnis.md`. Fraud rate, recovery rate, dan nilai klaim cabang adalah asumsi. Itu bukan penghematan nyata.
- Latensi dan throughput diukur di satu mesin, penyimpanan memori, tanpa LLM eksternal.
- Mode Docker: image ml dibangun dan diuji sendiri (model siap, versi sama dengan ml lokal). `docker compose up` penuh (db + samar + ml) belum saya jalankan ujung ke ujung. Mode ini tidak dipakai untuk pengukuran evaluasi.
- Token berlaku dalam satu epoch (default 30 hari); rotasi memutus tautan lintas epoch. Privacy Service adalah titik terpusat (roadmap: KMS/HSM, persetujuan dua orang untuk reveal).
- Dipotong dari T2: modul faskes cek mandiri, ekspor PDF (cukup CSV), persetujuan kedua reveal, webhook notify.

## Posisi terhadap sistem BPJS yang ada

SAMAR **melengkapi, bukan menggantikan**, sistem yang sudah dipakai BPJS Kesehatan seperti Voltage (tokenisasi), FRISTA, VIDI, dan SIGAP. SAMAR tidak mengklaim masalah ini belum punya solusi. Yang ditambahkan:

- token yang konsisten lintas faskes untuk satu tujuan, berbeda antar tujuan, berotasi, dan bisa dicabut, dipakai untuk deteksi lintas faskes;
- pemisahan peran pada alur kasus: verifikator menilai dari pola dan tidak punya aksi buka identitas; ia meminta berkas ke faskes atau eskalasi ke auditor.

Integrasi lewat adaptor API (misalnya adaptor `voltage` sebagai mesin token): **rencana, belum terhubung** ke sistem BPJS mana pun. Di sistem nyata data klaim berasal dari sistem klaim BPJS (VClaim, PCare) lewat API; unggah CSV di prototype ini hanya jalur pilot.

## Pemeriksaan keamanan

Tinjauan 27 Okt 2026 atas seluruh perubahan sejak prototype awal: 16 temuan (High 4, Medium 7, Low 5), 11 diperbaiki, 5 dicatat sebagai batasan. Rincian dan tesnya ada di `docs/CHANGELOG.md` dan `test/security/` (jalankan `npm test`).

Diperbaiki, antara lain: layanan zona token tidak lagi memegang kunci vault atau JWT; kuota reveal aman dari permintaan paralel; ekspor CSV di-escape terhadap injeksi rumus; keluaran LLM disanitasi dan disaring PII; production non-demo menolak rahasia kosong, pendek, atau default; port db tidak dibuka ke host; image non-root dengan `.dockerignore`; `npm audit` dan `pip-audit` bersih.

Batasan yang tersisa: kunci reveal dan audit berlaku per proses (satu instance Privacy Service); tanpa `DATABASE_URL_<LAYANAN>` semua layanan berbagi satu kredensial DB; token sesi lewat query string untuk iframe evidence card; lalu lintas antar-layanan tanpa mTLS; JWT tanpa daftar pencabutan. Ini bukan audit keamanan independen, dan `/code-review` terpisah belum dijalankan.

Untuk `npm start` di host dengan Postgres: `docker compose -f docker-compose.yml -f docker-compose.hostdb.yml up -d db` (port 5433 hanya di loopback).

## Status integrasi

Semua integrasi di bawah ini **rencana, belum terhubung**. Prototype berdiri sendiri dan tidak memanggil sistem BPJS mana pun.

| Sistem | Status |
|---|---|
| Voltage (mesin token BPJS) | rencana, belum terhubung; token saat ini dari HMAC lokal |
| VClaim / Smart Claim | rencana, belum terhubung; `POST /verify` dirancang sebagai titik tempel |
| JKN Data Hub | rencana, belum terhubung |
| SATUSEHAT, INA-CBG resmi | tidak tercakup; tarif referensi bersifat ilustratif |

## Struktur

```
shared/     config, http, store (memory/file/postgres), generator sintetis, metrik evaluasi
services/   gateway, auth, privacy, claims, fraud, notify, ml (Python)
web/        frontend tipis (HTML + JS), disajikan gateway
scripts/    dev, stack, evaluate (+ eval/), generate-data, demo-reset, render-readme
config/     weights.json, column-map.json, pilot-cost.json
docs/       spesifikasi, openapi.yaml, CHANGELOG.md, video-cheatsheet.md, screens/
reports/    keluaran npm run evaluate
```
