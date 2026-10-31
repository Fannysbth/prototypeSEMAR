// URL Postgres per zona dari satu URL admin. Dipakai tes (SAMAR_TEST_PG), seed, dan demo:reset.
import pg from 'pg';
import { migrate } from './migrate.js';

const PASSWORDS = { private: 'samar-private-dev-pass', token: 'samar-token-dev-pass' };

export function zoneUrls(adminUrl, passwords = PASSWORDS) {
  const as = (user, pass) => { const u = new URL(adminUrl); u.username = user; u.password = pass; return u.toString(); };
  const priv = as('samar_private', passwords.private); const tok = as('samar_token', passwords.token);
  return {
    DATABASE_URL_PRIVACY: priv, DATABASE_URL_GATEWAY: priv,
    DATABASE_URL_CLAIMS: tok, DATABASE_URL_FRAUD: tok, DATABASE_URL_NOTIFY: tok,
  };
}

// Kosongkan semua data zona (skema dibuang lalu migrasi dijalankan ulang) dan kembalikan env untuk startStack.
export async function resetDatabase(adminUrl, { passwords = PASSWORDS } = {}) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try { await c.query('DROP SCHEMA IF EXISTS vault, analytics, audit CASCADE; DROP TABLE IF EXISTS public.schema_migrations'); } finally { await c.end(); }
  await migrate({ adminUrl, privatePassword: passwords.private, tokenPassword: passwords.token, log: () => {} });
  return { STORE: 'postgres', DATABASE_URL: adminUrl, ...zoneUrls(adminUrl, passwords) };
}
