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

## Pemeriksaan keamanan (27 Okt 2026)
Cakupan: `git diff 8eca474..HEAD` (111 berkas) ditambah pemeriksaan seluruh repo dan riwayat git. `/security-review` bawaan tidak bisa dijalankan (repo tanpa remote, `origin/HEAD` tidak ada), jadi tinjauan dilakukan manual per butir daftar pemeriksaan; `/code-review` belum dijalankan terpisah. Tiap temuan nyata punya tes di `test/security/` yang ditulis gagal dulu. Hasil: 16 temuan (High 4, Medium 7, Low 5); 11 diperbaiki, 5 dicatat sebagai batasan.

Diperbaiki:
- High: `body-parser` (DoS, advisory GHSA-27r3-jxmh-p828) lewat `npm audit fix`; `zod` 3 ke 4.6.7 (GHSA-mrhx-c7xc-m3w5). `npm audit` kini 0 kerentanan, semua tes lama lulus tanpa perubahan.
- High: layanan zona token (claims, fraud, notify, ml) mewarisi seluruh env, termasuk `HMAC_MASTER_KEY` (kunci vault) dan `JWT_SECRET`, dan `.env` dimuat penuh oleh tiap layanan. Kini `shared/config.js` memuat hanya rahasia yang dibutuhkan per layanan (`SAMAR_SERVICE`) dan `scripts/stack.js` memangkas env tiap proses anak (`serviceEnv`). Mendukung `DATABASE_URL_<LAYANAN>` agar tiap layanan memakai peran DB sendiri.
- High: kuota reveal bisa dilewati dengan permintaan paralel (cek kuota dan tulis audit tidak atomik). Kini serial (`reidentify` di `services/privacy/core.js`); 12 permintaan paralel dengan kuota 3 menghasilkan tepat 3 berhasil dan rantai audit tetap valid.
- Medium: CSV injection pada ekspor (`cases.csv`, `scores.csv`, dll.): sel teks berawalan `= + - @ tab CR` diberi awalan apostrof (`shared/csv.js`).
- Medium: keluaran LLM tidak disaring. Kini tag HTML dan karakter kontrol dibuang, panjang dibatasi 1.200 karakter, penyaring PII dijalankan juga pada keluaran (PII, dan teks diganti templat), prompt membungkus data kasus dalam `<data_kasus>` dan menyatakannya data tidak tepercaya. Keluaran LLM hanya teks penjelasan dan tidak pernah memengaruhi skor, status, atau aksi.
- Medium: production non-demo kini menolak start bila rahasia kurang dari 32 karakter atau berupa nilai contoh/default (`ganti-...`); `DEMO_MODE=true` tetap boleh, dan itu satu-satunya jalur default di `docker-compose.yml`.
- Medium: port Postgres dipublikasikan ke host. Kini tidak; untuk `npm start` di host pakai `docker compose -f docker-compose.yml -f docker-compose.hostdb.yml up -d db` (hanya loopback). Perintah `docker compose up -d db` di CLAUDE.md tidak lagi membuka port 5433 ke host.
- Medium: tidak ada `.dockerignore` (`.env`, `data/`, `.git` bisa masuk image). Ditambahkan.
- Low: `Dockerfile.ml` berjalan sebagai root; kini user `samar`. `services/ml/requirements.txt` dikunci ke versi pasti (`pip-audit`: tidak ada kerentanan).

Dikonfirmasi aman (tes ditambahkan, tanpa perubahan kode): IDOR batch/klaim antar faskes dan unggah atas nama faskes lain; RBAC untuk setiap operasi di `docs/openapi.yaml` (tes gagal bila operasi baru tanpa aturan peran); header keamanan (CSP, nosniff, frame, referrer) dan CORS tertutup; respons error tanpa NIK, nama, atau stack trace; batas ukuran JSON dan jenis unggahan; kunci antar-layanan timing-safe; rate limit login dan `/verify`; kata sandi scrypt dengan perbandingan timing-safe; tidak ada `innerHTML`, `eval`, atau eksekusi shell dari input; tidak ada rahasia atau data riil di riwayat git (contoh `postgresql://...` hanya placeholder; `3273011234567890` di tes adalah angka karangan untuk menguji penolakan NIK riil).

Tidak diperbaiki (batasan):
- Medium: serialisasi reveal dan rantai audit memakai kunci dalam satu proses; beberapa instance Privacy Service butuh advisory lock Postgres.
- Medium: di mode Postgres, tanpa `DATABASE_URL_<LAYANAN>` semua layanan memakai satu kredensial DB. Penegakan penuh butuh peran DB per skema yang dibuat operator. Di mode pengembangan `data/.secrets.json` terbaca semua proses lokal.
- Low: evidence card dimuat iframe dengan token sesi di query string (`access_token`), yang bisa tercatat di riwayat browser atau log proxy; JWT berumur 15 menit dan rutenya hanya baca.
- Low: lalu lintas antar-layanan HTTP tanpa mTLS (loopback atau jaringan Docker internal).
- Low: JWT HS256 tanpa daftar pencabutan (mengandalkan umur 15 menit); dependensi Python transitif tidak dikunci dengan hash.
