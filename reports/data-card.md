# Data card (sintetis)

Dihasilkan oleh `scripts/generate-data`. Seluruh data sintetis; NIK berawalan 9999; tidak ada data peserta JKN riil.

| Parameter | Nilai |
|---|---|
| peserta (target) | 5000 |
| seed | 42 |
| fraud-rate (target, dari klaim wajar) | 0.03 |
| tanggal dasar | 2026-06-01 (sebaran ~80 hari) |
| pasien wajar / pasien kronis (hard negative) | 4250 / 500 |
| pengali skenario fraud | 3.04 |
| total klaim | 7578 |
| klaim berlabel fraud | 211 (2.78%) |
| modus hold-out (tidak dipakai melatih model supervised) | REPEAT_BILLING |

Batas: label berasal dari generator, bukan hasil audit BPJS. Metrik di data ini membuktikan mekanisme, bukan akurasi pada data riil.
