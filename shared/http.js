// Helper HTTP bersama: app dasar, autentikasi antar-layanan, penanganan error, klien antar-layanan.
import crypto from 'node:crypto';
import express from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// bigJson: [{ test: RegExp, limit: '300kb' }] menaikkan batas body JSON HANYA untuk rute tertentu (mis. balasan faskes dengan lampiran kecil).
export function createBaseApp({ service, config, bigJson = [] }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use((req, res, next) => {
    req.id = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 64);
    res.setHeader('x-request-id', req.id);
    next();
  });
  const defaultParser = express.json({ limit: '64kb' });
  const bigParsers = bigJson.map((b) => ({ test: b.test, parser: express.json({ limit: b.limit }) }));
  app.use((req, res, next) => (bigParsers.find((b) => b.test.test(req.path))?.parser ?? defaultParser)(req, res, next));
  app.get('/health', (req, res) => res.json({ ok: true, service, uptime_s: Math.round(process.uptime()) }));
  return app;
}

// Semua endpoint internal wajib membawa x-internal-key. Layanan internal HANYA mendengarkan 127.0.0.1.
export function requireInternalKey(config) {
  const expected = Buffer.from(config.secrets.INTERNAL_API_KEY);
  return (req, res, next) => {
    const got = Buffer.from(String(req.headers['x-internal-key'] || ''));
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
      return next(new HttpError(401, 'UNAUTHORIZED_INTERNAL', 'Akses antar-layanan ditolak'));
    }
    next();
  };
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } });
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR', message: 'Input tidak valid',
          details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
        request_id: req.id,
      });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body bukan JSON yang valid' }, request_id: req.id });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Body terlalu besar' }, request_id: req.id });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details }, request_id: req.id });
    }
    logger.error('unhandled error', { path: req.path, message: err?.message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server' }, request_id: req.id });
  };
}

export async function callService({ baseUrl, path, method = 'GET', body, internalKey, requestId, timeoutMs = 10000, headers = {} }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-internal-key': internalKey,
        ...(requestId ? { 'x-request-id': requestId } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
    if (!res.ok) {
      const e = data?.error;
      throw new HttpError(res.status, e?.code || 'UPSTREAM_ERROR', e?.message || `Layanan hulu gagal (${res.status})`, e?.details);
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'UPSTREAM_UNAVAILABLE', `Layanan ${baseUrl} tidak dapat dihubungi`);
  } finally {
    clearTimeout(timer);
  }
}

// "Tap" (hanya DEMO_MODE): merekam payload terakhir yang BENAR-BENAR diterima layanan ini.
// Dipakai Inspector di UI & skrip evaluasi sebagai bukti independen paparan PII per layanan.
export function createTap(config, max = config.tapMax) {
  const buf = [];
  return {
    middleware(req, res, next) {
      if (config.demoMode && req.method === 'POST' && req.body && Object.keys(req.body).length) {
        buf.push({ ts: Date.now(), path: req.path, body: structuredClone(req.body) });
        if (buf.length > max) buf.shift();
      }
      next();
    },
    list: () => buf.slice().reverse(),
    clear: () => { buf.length = 0; },
  };
}

export function mountTap(app, tap, config, auth) {
  app.get('/internal/tap', auth, (req, res) => {
    if (!config.demoMode) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tap nonaktif' } });
    res.json({ items: tap.list() });
  });
  app.delete('/internal/tap', auth, (req, res) => { tap.clear(); res.json({ cleared: true }); });
}

export function serve(app, { host, port, logger, onShutdown }) {
  const server = app.listen(port, host, () => logger.info(`aktif di ${host}:${port}`));
  server.on('error', (err) => {
    logger.error(err.code === 'EADDRINUSE' ? `Port ${port} sudah dipakai proses lain. Ubah port lewat environment atau hentikan proses tersebut.` : err.message);
    process.exit(1);
  });
  const stop = (sig) => {
    logger.info(`${sig} diterima, berhenti`);
    server.close(async () => {
      try { await onShutdown?.(); } catch { /* abaikan */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  return server;
}
