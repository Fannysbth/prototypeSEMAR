// INTI PSEUDONIMISASI DINAMIS (tanpa HTTP, murni logika -> mudah diuji).
//
// Pseudonim = HMAC(kunci_epoch, layanan | tujuan | subjek)
//   - kunci_epoch = HMAC(master, epoch)  ->  token BERUBAH tiap epoch (rotasi otomatis = kedaluwarsa)
//   - layanan & tujuan ikut dalam HMAC   ->  token pasien yang sama BERBEDA untuk tiap layanan/tujuan
//   - subjek sama + layanan/tujuan sama + epoch sama -> token SAMA, di faskes manapun
//     (inilah yang memungkinkan pencocokan lintas-faskes tanpa membuka identitas)
// Identitas asli disimpan terenkripsi AES-256-GCM (vault); audit log hanya memuat subject_ref (HMAC), tidak pernah NIK mentah.
// Aksi sensitif (reveal, revoke, rotasi kunci, ubah status kasus/ambang) dicatat di rantai hash (chain.js).
import crypto from 'node:crypto';
import { HttpError } from '../../shared/http.js';
import { ageBand, maskTail, scanForPii } from '../../shared/pii.js';
import { validatePolicy } from './policy.js';
import { GENESIS, computeHash, verifyChain } from './chain.js';

const hmacHex = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
const normName = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function createPrivacyCore({ mappings, audit, meta, config, policy, clock = () => Date.now() }) {
  validatePolicy(policy);
  const master = Buffer.from(config.secrets.HMAC_MASTER_KEY, 'utf8');
  const vaultKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'samar-vault-v1', 32));
  const refKey = hmacHex(master, 'samar-subject-ref-v1');

  const subjectRef = (subject) => hmacHex(refKey, subject).slice(0, 24);
  const newId = () => crypto.randomUUID();

  let head; let chainLock = Promise.resolve();
  async function loadHead() {
    if (!head) {
      const [last] = await audit.find({ gte: { seq: 1 } }, { orderBy: 'seq', dir: 'desc', limit: 1 });
      head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS };
    }
    return head;
  }
  // MINIMIZE (volume tinggi) tidak masuk rantai; semua aksi sensitif masuk. Antrian memastikan rantai tetap linear.
  function appendChained(entry) {
    const run = chainLock.then(async () => {
      const h = await loadHead();
      const full = { ...entry, seq: h.seq + 1, hash_prev: h.hash };
      full.hash = computeHash(full);
      await audit.put(newId(), full);
      head = { seq: full.seq, hash: full.hash };
    });
    chainLock = run.catch(() => {});
    return run;
  }
  const verifyAudit = async () => verifyChain(await audit.find({ gte: { seq: 1 } }, { orderBy: 'seq', dir: 'asc' }));

  let revokedRefs;
  async function revoked() {
    if (!revokedRefs) revokedRefs = new Set((await mappings.find({ eq: { status: 'revoked' } })).map((m) => m.subject_ref));
    return revokedRefs;
  }
  let rotation;
  async function getRotation() {
    if (rotation === undefined) rotation = (await meta?.get('rotation'))?.n ?? 0;
    return rotation;
  }

  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
  }
  function decrypt(blob) {
    const [, iv, tag, ct] = blob.split('.');
    const d = crypto.createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  }

  const ttlMsOf = (purpose) => (policy.purposes[purpose].ttl_seconds ?? config.tokenTtlSeconds) * 1000;
  function derive({ subject, service, purpose, now, rot = 0 }) {
    const ttl = ttlMsOf(purpose);
    const epoch = Math.floor(now / ttl);
    const epochKey = hmacHex(master, rot ? `epoch:${epoch}:r${rot}` : `epoch:${epoch}`);
    const mac = hmacHex(epochKey, `${service}|${purpose}|${subject}`);
    return { pseudonym: `PSE_${policy.purposes[purpose].tag}_${mac.slice(0, 20).toUpperCase()}`, epoch, expires_ms: (epoch + 1) * ttl };
  }

  // Menerapkan kebijakan minimisasi terhadap record mentah untuk layanan tujuan tertentu.
  async function minimize({ service, record, actor = 'gateway', now = clock() }) {
    const svc = policy.services[service];
    if (!svc) throw new HttpError(400, 'UNKNOWN_SERVICE', `Layanan tujuan tidak dikenal: ${service}`);
    const projection = {};
    const tokens = [];
    const rot = await getRotation();
    const blocked = await revoked();
    const groupRef = record.patient_nik ? subjectRef(String(record.patient_nik)) : undefined;
    for (const [name, rule] of Object.entries(svc.fields)) {
      const src = rule.source ?? name;
      const val = record[src];
      if (val === undefined || val === null) continue;
      if (rule.op === 'pass') projection[name] = val;
      else if (rule.op === 'age_band') projection[name] = ageBand(String(val), now);
      else if (rule.op === 'mask_tail') projection[name] = maskTail(val, rule.keep ?? 4);
      else if (rule.op === 'tokenize') {
        if (blocked.has(subjectRef(String(val)))) throw new HttpError(403, 'SUBJECT_REVOKED', 'Subjek sudah dicabut; klaim tidak diproses di analitik');
        const t = derive({ subject: String(val), service, purpose: rule.purpose, now, rot });
        projection[name] = t.pseudonym;
        tokens.push({ field: name, ...t, purpose: rule.purpose, subject: String(val) });
      } else if (rule.op === 'vault') {
        const subject = normName(String(val));
        tokens.push({ field: name, ...derive({ subject, service, purpose: rule.purpose, now, rot }), purpose: rule.purpose, subject, group_ref: groupRef, vault_only: true });
      }
    }
    await Promise.all(tokens.map((t) => mappings.insertIfAbsent(t.pseudonym, {
      pseudonym: t.pseudonym, service, purpose: t.purpose, epoch: t.epoch, expires_ms: t.expires_ms,
      subject_ref: subjectRef(t.subject), subject_enc: encrypt(t.subject), status: 'active', created_ms: now, group_ref: t.group_ref,
    })));
    await audit.put(newId(), {
      ts_ms: now, action: 'MINIMIZE', status: 'SUCCESS', requesting_service: service, actor,
      purpose: [...new Set(tokens.map((t) => t.purpose))].join(',') || '-', token_count: tokens.length,
    });
    return {
      projection,
      tokens: tokens.filter((t) => !t.vault_only).map((t) => ({ field: t.field, pseudonym: t.pseudonym, purpose: t.purpose, expires_ms: t.expires_ms })),
      policy_version: policy.version,
    };
  }

  // Membuka identitas: hanya peran yang diizinkan, layanan+tujuan PERSIS sama, belum kedaluwarsa/dicabut,
  // di bawah kuota per jam & per hari, dengan alasan tertulis & nomor kasus. Setiap percobaan (berhasil/ditolak) diaudit.
  // Pemeriksaan kuota + penulisan audit dijalankan serial: tanpa ini permintaan paralel sama-sama lolos cek kuota (balapan).
  // Kunci ini per proses; untuk beberapa instance Privacy Service perlu advisory lock Postgres (batasan, lihat README).
  let reidLock = Promise.resolve();
  function reidentify(args) {
    const run = reidLock.then(() => reidentifyUnlocked(args));
    reidLock = run.catch(() => {});
    return run;
  }
  async function reidentifyUnlocked({ pseudonym, requesting_service, purpose, actor, case_id, justification, now = clock() }) {
    const base = { ts_ms: now, action: 'REIDENTIFY', requesting_service, purpose, pseudonym, actor: actor.id, actor_role: actor.role, case_id };
    const deny = async (reason, status = 403, code = 'REIDENTIFY_DENIED', subject_ref) => {
      await appendChained({ ...base, status: 'DENIED', reason, justification_len: justification.length, subject_ref });
      throw new HttpError(status, code, 'Permintaan pembukaan identitas ditolak');
    };
    const roles = policy.purposes[purpose]?.reidentify_roles ?? [];
    if (!roles.includes(actor.role)) return deny('ROLE_NOT_ALLOWED');
    const used = await audit.count({ eq: { action: 'REIDENTIFY', actor: actor.id }, gte: { ts_ms: now - 3600000 } });
    const usedToday = await audit.count({ eq: { action: 'REIDENTIFY', actor: actor.id }, gte: { ts_ms: now - 86400000 } });
    if (used >= config.reidentifyMaxPerHour || usedToday >= (config.reidentifyMaxPerDay ?? Infinity)) return deny('QUOTA_EXCEEDED', 429, 'QUOTA_EXCEEDED');
    const m = await mappings.get(pseudonym);
    if (!m) return deny('NOT_FOUND');
    if (m.status !== 'active') return deny('REVOKED', 403, 'REIDENTIFY_DENIED', m.subject_ref);
    if (m.service !== requesting_service || m.purpose !== purpose) return deny('SERVICE_PURPOSE_MISMATCH', 403, 'REIDENTIFY_DENIED', m.subject_ref);
    if (now >= m.expires_ms) return deny('EXPIRED', 403, 'REIDENTIFY_DENIED', m.subject_ref);
    const subject = decrypt(m.subject_enc);
    await appendChained({ ...base, status: 'SUCCESS', justification_len: justification.length, subject_ref: m.subject_ref });
    return { subject_id: subject, expires_ms: m.expires_ms };
  }

  // Hak subjek data (UU PDP): cabut kemampuan re-identifikasi. Vault dihapus (crypto-shredding), token tetap ada
  // tetapi tidak akan pernah bisa dibuka lagi, dan klaim baru dari subjek ini ditolak di minimize().
  async function revokeSubject({ subject_id, pseudonym, actor, now = clock() }) {
    const ref = subject_id ? subjectRef(subject_id) : (await mappings.get(pseudonym))?.subject_ref;
    if (!ref) throw new HttpError(404, 'NOT_FOUND', 'Token tidak ditemukan');
    const list = [...await mappings.find({ eq: { subject_ref: ref } }, { limit: 1000 }), ...await mappings.find({ eq: { group_ref: ref } }, { limit: 1000 })];
    for (const m of list) await mappings.update(m.pseudonym, { status: 'revoked', subject_enc: null, revoked_ms: now });
    (await revoked()).add(ref);
    await appendChained({ ts_ms: now, action: 'REVOKE', status: 'SUCCESS', requesting_service: 'PRIVACY', actor: actor?.id || 'unknown', subject_ref: ref, token_count: list.length });
    return { revoked: list.length };
  }

  // Epoch baru: token yang diterbitkan setelah ini berbeda dari sebelumnya (riwayat lintas-epoch tidak lagi cocok).
  async function rotateKeys({ actor, now = clock() }) {
    rotation = (await getRotation()) + 1;
    await meta?.put('rotation', { n: rotation, ts_ms: now });
    await appendChained({ ts_ms: now, action: 'KEY_ROTATE', status: 'SUCCESS', requesting_service: 'PRIVACY', actor: actor?.id || 'unknown', reason: `rotasi ke-${rotation}` });
    return { rotation, effective_ms: now };
  }

  // Dicatat gateway untuk aksi di luar privacy (ubah status kasus, ubah ambang).
  async function recordEvent({ action, actor, role, target, reason, now = clock() }) {
    await appendChained({ ts_ms: now, action, status: 'SUCCESS', requesting_service: 'GATEWAY', actor, actor_role: role, case_id: target, reason });
  }

  // Penyaring PII sebelum teks dikirim ke LLM: pola NIK/telepon, atau nilai yang ada di vault (nama pasien).
  async function screenText(text) {
    const hits = scanForPii(text);
    const words = String(text).toLowerCase().match(/[\p{L}\p{N}'.-]+/gu) ?? [];
    const refs = new Set();
    for (let i = 0; i < words.length; i += 1) for (let n = 1; n <= 3 && i + n <= words.length; n += 1) refs.add(subjectRef(words.slice(i, i + n).join(' ')));
    if (refs.size && (await mappings.find({ in: { subject_ref: [...refs] }, eq: { purpose: 'NAME_SCREEN' } }, { limit: 1 })).length) hits.push('vault');
    return { hits };
  }

  const listAudit = (limit = 100) => audit.find({ gte: { seq: 1 } }, { orderBy: 'seq', dir: 'desc', limit });

  async function stats() {
    return {
      tokens_total: await mappings.count({}),
      tokens_active: await mappings.count({ eq: { status: 'active' } }),
      tokens_revoked: await mappings.count({ eq: { status: 'revoked' } }),
      reidentify_success: await audit.count({ eq: { action: 'REIDENTIFY', status: 'SUCCESS' } }),
      reidentify_denied: await audit.count({ eq: { action: 'REIDENTIFY', status: 'DENIED' } }),
      minimize_calls: await audit.count({ eq: { action: 'MINIMIZE' } }),
      policy_version: policy.version,
    };
  }

  const policyView = () => ({
    version: policy.version, purposes: policy.purposes,
    services: Object.fromEntries(Object.entries(policy.services).map(([k, v]) => [k, { allowed_purposes: v.allowed_purposes, fields: v.fields }])),
    token_ttl_seconds: config.tokenTtlSeconds,
  });

  return { minimize, reidentify, revokeSubject, rotateKeys, recordEvent, screenText, verifyAudit, listAudit, stats, policyView, subjectRef };
}
