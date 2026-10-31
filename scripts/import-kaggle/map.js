// Pemetaan dataset Kaggle "Healthcare Provider Fraud Detection Analysis" -> skema SAMAR (docs/04-skema-data.md).
// CATATAN DATA (berlaku untuk seluruh keluaran):
//  - Kode diagnosis/prosedur adalah ICD-9 (BUKAN ICD-10), meski kolomnya bernama diag_utama.
//  - Nilai dalam USD, tahun 2009 (klaim Medicare AS). inacbg berisi DRG, padanan kasar INA-CBG.
//  - Label PotentialFraud berlaku per PENYEDIA, bukan per klaim.
//  - BeneID diperlakukan seperti PSTV01: wajib ditokenisasi lewat layanan privacy.
const clean = (v) => { const s = String(v ?? '').trim(); return s === 'NA' ? '' : s; };
const codes = (row, prefix, n) => Array.from({ length: n }, (_, i) => clean(row[`${prefix}${i + 1}`])).filter(Boolean);
const GENDER = { 1: 'L', 2: 'P' }; // Medicare: 1 = laki-laki, 2 = perempuan

function mapClaim(row, level) {
  const [diagUtama, ...secondary] = codes(row, 'ClmDiagnosisCode_', 10);
  const inpatient = level === 'RI';
  return {
    claim: {
      FKL02: row.ClaimID, PSTV01: row.BeneID, faskes_id: row.Provider, jenis_faskes: '', kab_kota_faskes: '',
      tgl_masuk: clean(inpatient ? row.AdmissionDt : row.ClaimStartDt) || clean(row.ClaimStartDt),
      tgl_pulang: clean(inpatient ? row.DischargeDt : row.ClaimEndDt) || clean(row.ClaimEndDt),
      jenis_layanan: level, diag_utama: diagUtama ?? '', prosedur: codes(row, 'ClmProcedureCode_', 6).join('|'),
      inacbg: inpatient ? clean(row.DiagnosisGroupCode) : '', kelas_rawat: '',
      FKL47: clean(row.InscClaimAmtReimbursed), FKL48: '', faskes_perujuk: '', attending_physician: clean(row.AttendingPhysician),
    },
    secondary: secondary.map((kode_icd10) => ({ id_kunjungan: row.ClaimID, kode_icd10 })),
  };
}

export function mapKaggle({ bene, inpatient, outpatient }) {
  const fkrtl = []; const diagSekunder = [];
  for (const [rows, level] of [[inpatient, 'RI'], [outpatient, 'RJ']]) {
    for (const row of rows) { const m = mapClaim(row, level); fkrtl.push(m.claim); diagSekunder.push(...m.secondary); }
  }
  const used = new Set(fkrtl.map((c) => c.PSTV01));
  const peserta = bene.filter((b) => used.has(b.BeneID)).map((b) => ({
    PSTV01: b.BeneID, PSTV02: '', nik: '', nama: '', tgl_lahir: clean(b.DOB), jenis_kelamin: GENDER[clean(b.Gender)] ?? '',
    kab_kota: `${clean(b.State)}-${clean(b.County)}`, segmen: '', PSTV15: '',
  }));
  return { fkrtl, peserta, diagSekunder };
}

// Subset N penyedia, stratified per label (proporsi label dipertahankan), deterministik menurut seed.
export function sampleProviders(labels, n, seed = 42) {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  if (!Number.isFinite(n) || n >= labels.length) return labels;
  const picked = [];
  for (const label of ['Yes', 'No']) {
    const group = labels.filter((l) => l.label === label).sort((a, b) => a.faskes_id.localeCompare(b.faskes_id));
    for (let i = group.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
    picked.push(...group.slice(0, Math.max(1, Math.round((n * group.length) / labels.length))));
  }
  return picked;
}
