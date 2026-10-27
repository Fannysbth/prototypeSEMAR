# Kartu bukti

## Kondisi pengujian

|  |  |
|---|---|
| Sumber data | sintetis |
| Tolok ukur | tidak dinyatakan |
| Generator ditulis oleh | tidak dinyatakan |
| Dikalibrasi ke | tidak dinyatakan |
| Seed | 42 |
| Entitas yang dinilai | 2.120 |
| Prevalensi | 2,6% |
| Kapasitas audit k | 1% (22 klaim, asumsi) |

## Hasil utama pada kapasitas k

|  |  |
|---|---|
| precision@k | 1,00 (IK 95% 1,00–1,00, resampling per pasien) |
| Lift dibanding acak | 38,5× |
| Recall rupiah@k | 42,1% |
| Persentase pasien jujur yang diaudit | 0 / 1.508 (0%) |

## Positif palsu tingkat entitas

0 dari 2.065 klaim jujur termasuk kasus yang ditandai (tingkat positif palsu 0%). Bukan metrik utama: pada kapasitas tetap angka ini selalu kecil. Persentase pasien jujur yang diaudit menunjukkan di mana bebannya jatuh.

## Recall@k per modus

| Modus | Kasus | Masuk k teratas | Recall |
|---|---|---|---|
| PHANTOM_BILLING | 10 | 10 | 1,00 |
| PROCEDURE_MISMATCH | 2 | 0 | 0,00 (lemah) |
| PROLONGED_LOS | 6 | 5 | 0,83 |
| REPEAT_BILLING | 11 | 0 | 0,00 (lemah) |
| SELF_REFERRAL | 10 | 5 | 0,50 |
| UNBUNDLING | 10 | 0 | 0,00 (lemah) |
| UPCODING | 6 | 2 | 0,33 |

## Persentase pasien jujur yang diaudit, per strata

| Strata | Nilai | Jujur | Ditandai | Tingkat |
|---|---|---|---|---|
| level | B | 795 | 0 | 0% |
| level | C | 713 | 0 | 0% |
| region | Barat | 797 | 0 | 0% |
| region | Timur | 711 | 0 | 0% |
| ukuran | besar | 489 | 0 | 0% |
| ukuran | sedang | 507 | 0 | 0% |
| ukuran | kecil | 512 | 0 | 0% |

## Keterbatasan

- Data sintetis; kinerja pada klaim nyata belum diukur.
- Lemah pada PROCEDURE_MISMATCH (recall@k di bawah 0,30).
- Lemah pada REPEAT_BILLING (recall@k di bawah 0,30).
- Lemah pada UNBUNDLING (recall@k di bawah 0,30).

## Untuk juri

Dari 22 klaim yang diaudit pada asumsi kapasitas kami (1%), 22 (IK 95% 22–22) merupakan fraud pada pengujian ini, 38,5× dibanding pemilihan acak. Dari 1.508 pasien yang jujur, 0 ikut diaudit.
