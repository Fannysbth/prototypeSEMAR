// Konfigurasi terpusat. Semua nilai dibaca dari environment (atau file .env di root).
// Mode development = nol-konfigurasi: secret dibuat otomatis & disimpan di data/.secrets.json.
// Mode production (NODE_ENV=production) = semua secret WAJIB diisi lewat environment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const env = (name, def) => {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
};
const bool = (v, def) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, def) => {
  const n = Number(v);
  return v === undefined || Number.isNaN(n) ? def : n;
};

const SECRET_NAMES = ['JWT_SECRET', 'HMAC_MASTER_KEY', 'INTERNAL_API_KEY'];

function resolveSecrets(dataDir, isProd) {
  const out = {};
  const missing = [];
  for (const n of SECRET_NAMES) {
    const v = env(n);
    if (v) out[n] = v;
    else missing.push(n);
  }
  if (!missing.length) return out;
  if (isProd) {
    throw new Error(`Environment wajib belum diisi untuk production: ${missing.join(', ')}. Buat dengan: npm run gen-secrets`);
  }
  const file = path.join(dataDir, '.secrets.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* belum ada */ }
  let changed = false;
  for (const n of missing) {
    if (!saved[n]) { saved[n] = crypto.randomBytes(32).toString('hex'); changed = true; }
    out[n] = saved[n];
  }
  if (changed) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  }
  return out;
}

let cached;
export function getConfig() {
  if (cached) return cached;
  loadDotEnv(path.join(ROOT, '.env'));

  const nodeEnv = env('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';
  const demoMode = bool(env('DEMO_MODE'), !isProd);
  const dataDir = path.resolve(env('DATA_DIR', path.join(ROOT, 'data')));
  const databaseUrl = env('DATABASE_URL', '');
  const storeDriver = env('STORE', databaseUrl ? 'postgres' : 'file');
  if (!['memory', 'file', 'postgres'].includes(storeDriver)) throw new Error(`STORE tidak valid: ${storeDriver}`);
  if (storeDriver === 'postgres' && !databaseUrl) throw new Error('STORE=postgres membutuhkan DATABASE_URL (connection string Neon).');

  const ports = {
    gateway: num(env('PORT', env('GATEWAY_PORT')), 3000),
    auth: num(env('AUTH_PORT'), 4101),
    privacy: num(env('PRIVACY_PORT'), 4102),
    claims: num(env('CLAIMS_PORT'), 4103),
    fraud: num(env('FRAUD_PORT'), 4104),
    notify: num(env('NOTIFY_PORT'), 4105),
    ml: num(env('ML_PORT'), 4106),
  };
  const urlOf = (name, port) => env(`${name.toUpperCase()}_URL`, `http://127.0.0.1:${port}`);

  cached = Object.freeze({
    nodeEnv, isProd, demoMode,
    syntheticOnly: bool(env('SYNTHETIC_ONLY'), true),
    defaultMode: env('DEFAULT_MODE', 'proposed'),
    allowBaseline: bool(env('ALLOW_BASELINE_MODE'), demoMode),
    logLevel: env('LOG_LEVEL', 'info'),
    host: env('HOST', '0.0.0.0'),
    internalHost: env('INTERNAL_HOST', '127.0.0.1'),
    ports,
    urls: {
      auth: urlOf('auth', ports.auth), privacy: urlOf('privacy', ports.privacy),
      claims: urlOf('claims', ports.claims), fraud: urlOf('fraud', ports.fraud), notify: urlOf('notify', ports.notify), ml: urlOf('ml', ports.ml),
    },
    secrets: resolveSecrets(dataDir, isProd),
    store: { driver: storeDriver, dataDir, databaseUrl },
    allowedOrigin: env('ALLOWED_ORIGIN', ''),
    trustProxy: num(env('TRUST_PROXY'), 0),
    tapMax: num(env('TAP_MAX'), 80),
    rateLimitPerMin: num(env('RATE_LIMIT_PER_MIN'), 600),
    verifyRateLimitPerMin: num(env('VERIFY_RATE_LIMIT_PER_MIN'), 300),
    loginMaxFailsPerMin: num(env('LOGIN_MAX_FAILS_PER_MIN'), 20),
    tokenTtlSeconds: num(env('TOKEN_TTL_SECONDS'), 2592000),
    reidentifyMaxPerHour: num(env('REIDENTIFY_MAX_PER_HOUR'), 10),
    mlEnabled: bool(env('ML_ENABLED'), true),
    reidentifyMaxPerDay: num(env('REIDENTIFY_MAX_PER_DAY'), 20),
    jwtTtlSeconds: num(env('JWT_TTL_SECONDS'), 900),
    llm: { provider: env('LLM_PROVIDER', 'anthropic'), model: env('LLM_MODEL', ''), apiKey: env('LLM_API_KEY', ''), baseUrl: env('LLM_BASE_URL', ''), timeoutMs: num(env('LLM_TIMEOUT_MS'), 5000) },
    truthFile: env('TRUTH_FILE', path.join(dataDir, 'synthetic', 'truth.csv')),
    authUsersJson: env('AUTH_USERS_JSON', ''),
  });
  return cached;
}
