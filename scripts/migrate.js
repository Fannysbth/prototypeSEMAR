// npm run migrate : terapkan db/migrations/*.sql dengan akun admin lalu set kata sandi peran zona.
// Env: DATABASE_URL_ADMIN (atau DATABASE_URL), PRIVATE_DB_PASSWORD, TOKEN_DB_PASSWORD.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { ROOT } from '../shared/config.js';

export async function migrate({ adminUrl, privatePassword, tokenPassword, log = console.log }) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = path.join(ROOT, 'db', 'migrations');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM public.schema_migrations WHERE name = $1', [file])).rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) { await client.query('ROLLBACK'); throw err; }
      log(`migrasi ${file} diterapkan`);
    }
    // Kata sandi diset tiap kali agar perubahan env berlaku; DDL tidak mendukung parameter, jadi literal di-escape.
    if (privatePassword) await client.query(`ALTER ROLE samar_private PASSWORD ${client.escapeLiteral(privatePassword)}`);
    if (tokenPassword) await client.query(`ALTER ROLE samar_token PASSWORD ${client.escapeLiteral(tokenPassword)}`);
  } finally { await client.end(); }
}

if (process.argv[1]?.endsWith('migrate.js')) {
  const adminUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (!adminUrl) { console.error('Set DATABASE_URL_ADMIN (akun pemilik database).'); process.exit(1); }
  await migrate({ adminUrl, privatePassword: process.env.PRIVATE_DB_PASSWORD, tokenPassword: process.env.TOKEN_DB_PASSWORD });
  console.log('Migrasi selesai.');
}
