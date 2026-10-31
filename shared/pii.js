// Utilitas data pribadi: masking, generalisasi umur, dan pemindai paparan PII.
export const PII_FIELDS = ['patient_nik', 'patient_name', 'phone', 'birth_date', 'record_number'];

export function maskTail(value, keep = 4) {
  const s = String(value);
  if (s.length <= keep) return '*'.repeat(s.length);
  return '*'.repeat(s.length - keep) + s.slice(-keep);
}

export function ageBand(birthDate, nowMs = Date.now()) {
  const b = Date.parse(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(b)) return 'unknown';
  const age = Math.floor((nowMs - b) / (365.25 * 86400000));
  if (age < 5) return '0-4';
  if (age < 18) return '5-17';
  if (age < 40) return '18-39';
  if (age < 60) return '40-59';
  return '60+';
}

// Dibatasi karakter non-alfanumerik agar potongan angka di dalam token heksadesimal tidak dianggap NIK/telepon.
const RE_NIK = /(?<![A-Za-z0-9])\d{16}(?![A-Za-z0-9])/;
// BeneID dataset Kaggle diperlakukan seperti PSTV01: tidak boleh muncul mentah di zona token atau di teks untuk LLM.
const RE_BENEID = /(?<![A-Za-z0-9])BENE\d{3,}(?![A-Za-z0-9])/;
const RE_PHONE = /(?<![A-Za-z0-9])(\+62|0)8\d{7,12}(?![A-Za-z0-9])/;

// Memindai payload & mengembalikan kategori PII ASLI yang terlihat.
// knownPii: Map<string, kategori> berisi nilai PII asli dari dataset sintetis (untuk deteksi nama/RM/tgl lahir).
export function scanForPii(payload, knownPii = new Map()) {
  const found = new Set();
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
    const s = String(v);
    if (knownPii.has(s)) found.add(knownPii.get(s));
    if (RE_NIK.test(s)) found.add('nik');
    if (RE_PHONE.test(s)) found.add('phone');
    if (RE_BENEID.test(s)) found.add('beneid');
  };
  walk(payload);
  return [...found].sort();
}
