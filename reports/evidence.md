# Kartu bukti

## Kondisi pengujian

|  |  |
|---|---|
| Sumber data | sintetis |
| Tolok ukur | tidak dinyatakan |
| Generator ditulis oleh | tidak dinyatakan |
| Dikalibrasi ke | tidak dinyatakan |
| Seed | 42 |
| Entitas yang dinilai | 2.097 |
| Prevalensi | 2,7% |
| Kapasitas audit k | 1% (21 klaim, asumsi) |

## Hasil utama pada kapasitas k

|  |  |
|---|---|
| precision@k | 1,00 (IK 95% 1,00–1,00, resampling per pasien) |
| Lift dibanding acak | 37,4× |
| Recall rupiah@k | 45,5% |
| Persentase pasien jujur yang diaudit | 0 / 1.500 (0%) |

## Positif palsu tingkat entitas

0 dari 2.041 klaim jujur termasuk kasus yang ditandai (tingkat positif palsu 0%). Bukan metrik utama: pada kapasitas tetap angka ini selalu kecil. Persentase pasien jujur yang diaudit menunjukkan di mana bebannya jatuh.

## Recall@k per modus

| Modus | Kasus | Masuk k teratas | Recall |
|---|---|---|---|
| CLONING | 15 | 2 | 0,13 (lemah) |
| PHANTOM_BILLING | 8 | 8 | 1,00 |
| PROLONGED_LOS | 3 | 0 | 0,00 (lemah) |
| REPEAT_BILLING | 5 | 0 | 0,00 (lemah) |
| SELF_REFERRAL | 10 | 1 | 0,10 (lemah) |
| UNBUNDLING | 4 | 0 | 0,00 (lemah) |
| UPCODING | 11 | 10 | 0,91 |

## Persentase pasien jujur yang diaudit, per strata

| Strata | Nilai | Jujur | Ditandai | Tingkat |
|---|---|---|---|---|
| level | B | 787 | 0 | 0% |
| level | C | 713 | 0 | 0% |
| region | Barat | 796 | 0 | 0% |
| region | Timur | 704 | 0 | 0% |
| ukuran | besar | 492 | 0 | 0% |
| ukuran | sedang | 504 | 0 | 0% |
| ukuran | kecil | 504 | 0 | 0% |

## Keterbatasan

- Data sintetis; kinerja pada klaim nyata belum diukur.
- Lemah pada CLONING (recall@k di bawah 0,30).
- Lemah pada PROLONGED_LOS (recall@k di bawah 0,30).
- Lemah pada REPEAT_BILLING (recall@k di bawah 0,30).
- Lemah pada SELF_REFERRAL (recall@k di bawah 0,30).
- Lemah pada UNBUNDLING (recall@k di bawah 0,30).

## Untuk juri

Dari 21 klaim yang diaudit pada asumsi kapasitas kami (1%), 21 (IK 95% 21–21) merupakan fraud pada pengujian ini, 37,4× dibanding pemilihan acak. Dari 1.500 pasien yang jujur, 0 ikut diaudit.
