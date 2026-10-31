-- Pemisahan zona di Postgres.
--   vault     : zona pribadi (privacy, gateway). Identitas terenkripsi AES-256-GCM di dokumen privacy_mappings.
--   analytics : zona token (claims, fraud, notify). Tidak ada GRANT ke vault.
--   audit     : audit_log berantai hash. Zona pribadi INSERT + SELECT, zona token INSERT saja; tidak ada UPDATE/DELETE.
-- Peran dibuat NOLOGIN-aman: kata sandi diset oleh runner (npm run migrate) dari env, bukan di file ini.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'samar_private') THEN CREATE ROLE samar_private LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'samar_token') THEN CREATE ROLE samar_token LOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;
REVOKE ALL ON SCHEMA vault, analytics, audit, public FROM PUBLIC;

-- Zona pribadi: seluruh vault, baca/tulis audit. Tidak ada akses ke analytics.
GRANT USAGE, CREATE ON SCHEMA vault TO samar_private;
GRANT USAGE ON SCHEMA audit TO samar_private;
ALTER DEFAULT PRIVILEGES IN SCHEMA vault GRANT ALL ON TABLES TO samar_private;

-- Zona token: analytics saja. Tidak ada GRANT ke vault.
GRANT USAGE, CREATE ON SCHEMA analytics TO samar_token;
GRANT USAGE ON SCHEMA audit TO samar_token;

-- audit_log dimiliki admin migrasi; dokumen jsonb memuat seq, hash_prev, hash (sha256 hash_prev + isi baris).
CREATE TABLE IF NOT EXISTS audit.audit_log (
  id text PRIMARY KEY,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_log_action ON audit.audit_log ((doc->>'action'));
CREATE INDEX IF NOT EXISTS ix_audit_log_actor ON audit.audit_log ((doc->>'actor'));
CREATE INDEX IF NOT EXISTS ixn_audit_log_ts_ms ON audit.audit_log (((doc->>'ts_ms')::numeric));
CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_log_seq ON audit.audit_log (((doc->>'seq')::numeric));
GRANT SELECT, INSERT ON audit.audit_log TO samar_private;
GRANT INSERT ON audit.audit_log TO samar_token;
