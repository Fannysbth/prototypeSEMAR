// AUTH SERVICE - login & penerbitan JWT (HS256) dengan peran: facility | verifier | auditor | admin.
import crypto from 'node:crypto';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { getConfig } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { FACILITIES } from '../../shared/reference.js';
import { asyncHandler, createBaseApp, errorHandler, HttpError, notFound, requireInternalKey, serve } from '../../shared/http.js';

const config = getConfig();
const logger = createLogger('auth', config.logLevel, config.isProd);

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const checkPw = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'); const b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Pengguna DEMO (hanya saat DEMO_MODE). Di production isi AUTH_USERS_JSON:
// [{"username":"...","password":"...","role":"facility|verifier|auditor|admin","facility_id":"RS-A","name":"..."}]
const DEMO_USERS = [
  ...FACILITIES.map((f) => ({ username: `rs.${f.name.split(' ')[1].toLowerCase()}`, password: `demo-${f.name.split(' ')[1].toLowerCase()}`, role: 'facility', facility_id: f.id, name: f.name })),
  { username: 'verifikator', password: 'demo-verifikator', role: 'verifier', name: 'Verifikator BPJS (demo)' },
  { username: 'auditor', password: 'demo-auditor', role: 'auditor', name: 'Auditor SPI (demo)' },
  { username: 'admin', password: 'demo-admin', role: 'admin', name: 'Admin / DPO (demo)' },
];
let users;
if (config.authUsersJson) users = JSON.parse(config.authUsersJson);
else if (config.demoMode) users = DEMO_USERS;
else throw new Error('Production membutuhkan AUTH_USERS_JSON (daftar pengguna). Lihat README.');
const records = users.map((u) => ({ ...u, hash: hashPw(u.password), password: undefined }));
const DUMMY = hashPw('dummy-password'); // supaya waktu respons sama baik user ada maupun tidak

const app = createBaseApp({ service: 'auth', config });
const auth = requireInternalKey(config);
const loginSchema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) });

app.post('/v1/login', auth, asyncHandler(async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  const u = records.find((r) => r.username === username);
  const ok = checkPw(password, u ? u.hash : DUMMY) && !!u;
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username atau password salah');
  const user = { sub: u.username, role: u.role, facility_id: u.facility_id || null, name: u.name };
  const token = jwt.sign(user, config.secrets.JWT_SECRET, { algorithm: 'HS256', expiresIn: '2h' });
  res.json({ token, user, expires_in: 7200 });
}));

app.get('/v1/demo-users', auth, (req, res) => {
  if (!config.demoMode) throw new HttpError(404, 'NOT_FOUND', 'Tidak tersedia');
  res.json({ items: DEMO_USERS.map(({ username, password, role, name, facility_id }) => ({ username, password, role, name, facility_id })) });
});

app.use(notFound);
app.use(errorHandler(logger));
serve(app, { host: config.internalHost, port: config.ports.auth, logger });
