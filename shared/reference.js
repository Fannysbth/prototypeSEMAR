// DATA REFERENSI SINTETIS (ilustratif). BUKAN tarif INA-CBG resmi dan BUKAN data JKN riil.
// Dipakai deteksi untuk membandingkan klaim dengan kewajaran per diagnosis.
const proc = (arr) => arr;
export const REFERENCE = {
  'J18.9': { name: 'Pneumonia', expected_los: 4, max_los: 10, tariff_median: 6200000, procedures: proc(['87.44', '99.21', '93.96']) },
  'A09': { name: 'Gastroenteritis', expected_los: 3, max_los: 7, tariff_median: 3100000, procedures: proc(['99.18', '99.29']) },
  'I10': { name: 'Hipertensi esensial', expected_los: 1, max_los: 2, tariff_median: 850000, procedures: proc(['89.52', '89.03']) },
  'K35.8': { name: 'Apendisitis akut', expected_los: 3, max_los: 8, tariff_median: 9500000, procedures: proc(['47.09', '47.01']) },
  'O80': { name: 'Persalinan normal', expected_los: 2, max_los: 4, tariff_median: 3800000, procedures: proc(['73.59']) },
  'O82': { name: 'Persalinan sesar', expected_los: 4, max_los: 7, tariff_median: 12500000, procedures: proc(['74.1', '74.99']) },
  'E11.9': { name: 'Diabetes melitus tipe 2', expected_los: 3, max_los: 8, tariff_median: 4400000, procedures: proc(['89.03', '90.59']) },
  'N39.0': { name: 'Infeksi saluran kemih', expected_los: 3, max_los: 7, tariff_median: 3700000, procedures: proc(['99.21', '88.75']) },
  'I21.9': { name: 'Infark miokard akut', expected_los: 5, max_los: 12, tariff_median: 21000000, procedures: proc(['36.06', '88.56']) },
  'S72.0': { name: 'Fraktur leher femur', expected_los: 6, max_los: 14, tariff_median: 28000000, procedures: proc(['79.35', '81.52']) },
  'A90': { name: 'Demam berdarah dengue', expected_los: 4, max_los: 9, tariff_median: 4900000, procedures: proc(['99.04', '99.21']) },
  'J45.9': { name: 'Asma', expected_los: 3, max_los: 7, tariff_median: 3300000, procedures: proc(['93.94', '99.29']) },
  'K29.7': { name: 'Gastritis', expected_los: 1, max_los: 3, tariff_median: 2100000, procedures: proc(['45.13', '99.29']) },
};
// MAD (median absolute deviation) sintetis = 5% dari median tarif.
for (const r of Object.values(REFERENCE)) r.tariff_mad = Math.round(r.tariff_median * 0.05);

export const DIAGNOSES = Object.keys(REFERENCE);

export const FACILITIES = [
  { id: 'RS-A', name: 'RS Melati' },
  { id: 'RS-B', name: 'RS Kenanga' },
  { id: 'RS-C', name: 'RS Cempaka' },
  { id: 'RS-D', name: 'RS Anggrek' },
];
