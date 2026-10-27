# Data card (sintetis)

Dihasilkan oleh `npm run evaluate` (generator `scripts/generate-data`, `shared/synthetic.js`). Seluruh data sintetis: NIK berawalan 9999, tidak ada data peserta JKN riil dan tidak ada data sampel resmi BPJS. Tarif referensi ilustratif, bukan INA-CBG resmi.

| Parameter | Nilai |
|---|---|
| seed | 42, 43, 44 |
| fraud rate (target, dari klaim wajar) | 1%, 3% |
| peserta per run | 4000 |
| rentang tanggal | 180 hari sejak 2026-06-01 (hari 0-119 latih, 120-179 uji) |
| modus hold-out | REPEAT_BILLING |
| tingkat kesulitan | standar dan hard |
| kapasitas review | 1% klaim uji (asumsi) |

## Ukuran data per run
| Tingkat | Seed | Fraud rate | Klaim total | Klaim latih | Klaim uji | Fraud uji |
|---|---|---|---|---|---|---|
| standard | 42 | 1% | 5877 | 3849 | 2028 | 13 |
| standard | 43 | 1% | 5877 | 3917 | 1960 | 12 |
| standard | 44 | 1% | 5852 | 3926 | 1926 | 21 |
| standard | 42 | 3% | 6058 | 3961 | 2097 | 56 |
| standard | 43 | 3% | 6058 | 4040 | 2018 | 49 |
| standard | 44 | 3% | 6033 | 4065 | 1968 | 49 |
| hard | 42 | 1% | 5916 | 3879 | 2037 | 12 |
| hard | 43 | 1% | 5916 | 3921 | 1995 | 22 |
| hard | 44 | 1% | 5891 | 3955 | 1936 | 20 |
| hard | 42 | 3% | 6179 | 4059 | 2120 | 55 |
| hard | 43 | 3% | 6179 | 4117 | 2062 | 63 |
| hard | 44 | 3% | 6154 | 4140 | 2014 | 58 |

## Batas
- Seluruh data sintetis. Label berasal dari generator, bukan hasil audit BPJS. Angka membuktikan mekanisme, bukan akurasi pada data JKN riil.
- Generator dan detektor ditulis oleh pihak yang sama (satu tim); detektor aturan dirancang untuk pola yang sama dengan generator. Hasil pada set standar cenderung terlalu optimistis; set hard dibuat untuk mengurangi, bukan menghilangkan, bias itu.
- Kapasitas review 1% klaim adalah asumsi, bukan data kapasitas verifikator BPJS. Pada fraud rate 3% recall@1% dibatasi kapasitas, bukan kualitas model.
- Jumlah klaim fraud di set uji kecil (puluhan per run), sehingga selang kepercayaan lebar; recall per modus dan modus hold-out dihitung dari gabungan 6 run dan tetap berbasis puluhan kasus.
- Latensi dan throughput diukur di satu mesin dengan penyimpanan memori dan tanpa LLM eksternal; angka absolut bergantung perangkat.
- Tarif referensi per diagnosis ilustratif, bukan INA-CBG resmi. Estimasi rupiah berlebih adalah estimasi generator, bukan angka audit.
