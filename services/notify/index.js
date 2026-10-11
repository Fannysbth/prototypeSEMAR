// NOTIFICATION SERVICE - mengirim notifikasi ke kotak masuk verifikator (disimulasikan).
// Hanya menerima petunjuk pasien yang disamarkan (mis. ************0001), bukan identitas lengkap.
import { z } from 'zod';
import crypto from 'node:crypto';
import { getConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { createStore } from '../../shared/store.js';
import { asyncHandler, createBaseApp, createTap, errorHandler, mountTap, notFound, requireInternalKey, serve } from '../../shared/http.js';

const config = getConfig();
const logger = createLogger('notify', config.logLevel, config.isProd);
const store = await createStore({ driver: config.store.driver, namespace: 'notify', dataDir: config.store.dataDir, databaseUrl: config.store.databaseUrl, logger });
const outbox = await store.collection('outbox', { numericIndexes: ['created_ms'] });

const app = createBaseApp({ service: 'notify', config });
const auth = requireInternalKey(config);
const tap = createTap(config);
mountTap(app, tap, config, auth);

const scalar = z.union([z.string().max(300), z.number(), z.boolean(), z.null()]);
const schema = z.object({
  claim_id: z.string().min(3).max(64),
  facility_id: z.string().min(2).max(20),
  case_id: z.string().max(80).optional(),
  risk_level: z.string().max(10).optional(),
  modi: z.array(z.string().max(30)).max(12).optional(),
}).catchall(scalar.or(z.array(z.string())));

app.post('/v1/notifications', auth, tap.middleware, asyncHandler(async (req, res) => {
  const d = schema.parse(req.body);
  const id = crypto.randomUUID();
  const hint = d.patient_hint ? ` pasien ${d.patient_hint}` : '';
  const message = `Klaim ${d.claim_id} (${d.facility_id})${hint} ditandai risiko ${d.risk_level || '-'}: ${(d.modi || []).join(', ') || 'perlu ditinjau'}.`;
  await outbox.put(id, { notification_id: id, channel: 'verifier-inbox', message, case_id: d.case_id || null, created_ms: Date.now() });
  res.status(201).json({ notification_id: id });
}));
app.get('/v1/notifications', auth, asyncHandler(async (req, res) => {
  res.json({ items: await outbox.find({}, { orderBy: 'created_ms', dir: 'desc', limit: 50 }) });
}));

app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.internalHost, port: config.ports.notify, logger, onShutdown: () => store.close() });
