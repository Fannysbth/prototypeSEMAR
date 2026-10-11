// Logger sederhana dengan REDAKSI otomatis untuk field data pribadi.
// Prinsip: log tidak boleh pernah berisi NIK/nama/telepon/no. rekam medis.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT_KEYS = new Set([
  'patient_nik', 'nik', 'patient_name', 'name', 'phone', 'birth_date', 'record_number',
  'subject_id', 'subject', 'password', 'authorization', 'token', 'justification',
]);

export function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
  return out;
}

export function createLogger(service, level = 'info', json = false) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, meta) => {
    if (LEVELS[lvl] < min) return;
    const safe = meta === undefined ? undefined : redact(meta);
    if (json) {
      process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level: lvl, service, msg, ...(safe && { meta: safe }) })}\n`);
    } else {
      const tail = safe === undefined ? '' : ` ${JSON.stringify(safe)}`;
      process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} [${service}] ${msg}${tail}\n`);
    }
  };
  return {
    debug: (m, x) => emit('debug', m, x), info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x), error: (m, x) => emit('error', m, x),
  };
}
