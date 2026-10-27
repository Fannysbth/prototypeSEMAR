# Model Bisnis

## Posisi
SAMAR adalah platform internal BPJS Kesehatan, bukan produk yang dijual ke peserta. Nilainya datang dari dua hal: klaim tidak wajar yang tertahan sebelum dibayar, dan data lintas faskes yang bisa dianalisis tanpa membuka identitas.

## Lean canvas
| Blok | Isi |
|---|---|
| Masalah | Fraud lintas faskes sulit dilihat; membuka data utuh berisiko; verifikator kewalahan |
| Pengguna | Verifikator cabang, unit anti-fraud/SPI, tim data, DPO; faskes untuk cek mandiri |
| Nilai unik | Riwayat lintas faskes terbaca tanpa identitas; antrian review berbasis risiko dengan alasan |
| Solusi | Tokenisasi + deteksi aturan/ML + penjelasan + alur kasus + audit |
| Kanal | Pilot di 1 kantor cabang, lalu kedeputian wilayah, lalu nasional |
| Biaya | Infrastruktur (server/cloud internal BPJS), pemeliharaan, panggilan LLM, pelatihan pengguna |
| Manfaat terukur | Rupiah klaim tidak wajar yang tertahan, jam kerja verifikator yang hemat, nol paparan PII di analitik |
| Metrik kunci | precision@k, rupiah recall, waktu tinjau per kasus, jumlah reveal, false positive rate |
| Keunggulan | Bisa memakai Voltage BPJS sebagai mesin token; API-first sehingga menempel ke VClaim/Smart Claim |

## Skema keberlanjutan
1. **Pilot (3 bulan, 1 cabang)**: dijalankan pada data internal yang sudah ditokenisasi; ukur precision@k dan rupiah tertahan.
2. **Wilayah (6 bulan)**: model dilatih ulang dengan label hasil audit; integrasi API ke alur verifikasi.
3. **Nasional**: dikelola sebagai layanan bersama di JKN Data Hub; biaya ditanggung dari anggaran efisiensi.
4. **Opsional faskes**: modul cek mandiri sebelum klaim diajukan (mengurangi klaim dikembalikan). Bisa jadi layanan berbayar ringan atau syarat kemitraan.

Prinsip: lanjut ke tahap berikut hanya jika manfaat terukur > biaya operasional tahap itu.

## Simulasi dampak (fitur `/impact/simulate`)
```
klaim_tidak_wajar  = nilai_klaim_tahunan × fraud_rate
terdeteksi         = klaim_tidak_wajar × rupiah_recall_pada_k
tertahan           = terdeteksi × recovery_rate
manfaat_bersih     = tertahan − biaya_operasional
```
Semua parameter diisi pengguna dan ditampilkan di layar beserta sumbernya. Nilai default di demo berasal dari hasil evaluasi sintetis dan asumsi konservatif, diberi label "asumsi". Untuk video, pakai tiga skenario (rendah, sedang, tinggi) dan sebut sumber angka nilai klaim jika mengutip data publik BPJS. Jangan menyebut angka penghematan sebagai hasil nyata.

## Estimasi biaya pilot (asumsi, bukan penawaran)
Angka di bawah adalah perkiraan konservatif untuk 1 kantor cabang. Harga cloud dan gaji diambil dari kisaran umum pasar, belum diverifikasi ke BPJS. Di video sebut sebagai "estimasi", dan bila BPJS memakai infrastruktur sendiri, komponen server menjadi biaya internal yang sudah ada.

| Komponen | Asumsi | Biaya/bulan (Rp) |
|---|---|---|
| Server aplikasi + Postgres | 2 VM (4 vCPU, 16 GB), tanpa layanan terkelola | 3.000.000 |
| LLM penjelasan | 500 kasus/bulan x sekitar 1.500 token, model kelas menengah | 300.000 |
| Pemeliharaan | 1 engineer paruh waktu (sekitar 40%) | 7.500.000 |
| Cadangan & monitoring | Backup, log, domain/TLS | 500.000 |
| **Total pilot** | | **sekitar 11.300.000** |

Setahun sekitar Rp 136 juta. Titik impas pilot: klaim tertahan >= Rp 11,3 juta per bulan. Dari rumus simulasi, itu setara menahan sekitar 0,1% dari klaim tidak wajar senilai Rp 10 miliar per bulan di satu cabang (angka ilustrasi, ganti dengan data cabang yang sebenarnya jika ada).

Cara menggantinya: ubah tiga angka di tabel, lalu `/impact/simulate` memakai total ini sebagai `biaya_operasional`.
