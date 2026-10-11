// INTI PSEUDONIMISASI DINAMIS (tanpa HTTP, murni logika -> mudah diuji).
//
// Pseudonim = HMAC(kunci_epoch, layanan | tujuan | subjek)
//   - kunci_epoch = HMAC(master, epoch)  ->  token BERUBAH tiap epoch (rotasi otomatis = kedaluwarsa)
//   - layanan & tujuan ikut dalam HMAC   ->  token pasien yang sama BERBEDA untuk tiap layanan/tujuan
//   - subjek sama + layanan/tujuan sama + epoch sama -> token SAMA, di faskes manapun
//     (inilah yang memungkinkan pencocokan lintas-faskes tanpa membuka identitas)
// Identitas asli disimpan terenkripsi AES-256-GCM (vault); audit log hanya memuat subject_ref (HMAC), tidak pernah NIK mentah.
import crypto from 'node:crypto';
import { HttpError } from '../../shared/http.js';
import { ageBand, maskTail } from '../../shared/pii.js';
import { validatePolicy } from './policy.js';

const hmacHex = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');

export function createPrivacyCore({ mappings, audit, config, policy, clock = () => Date.now() }) {
  validatePolicy(policy);
  const master = Buffer.from(config.secrets.HMAC_MASTER_KEY, 'utf8');
  const vaultKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'samar-vault-v1', 32));
  const refKey = hmacHex(master, 'samar-subject-ref-v1');

  const subjectRef = (subject) => hmacHex(refKey, subject).slice(0, 24);
  const newId = () => crypto.randomUUID();

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
  function derive({ subject, service, purpose, now }) {
    const ttl = ttlMsOf(purpose);
    const epoch = Math.floor(now / ttl);
    const epochKey = hmacHex(master, `epoch:${epoch}`);
    const mac = hmacHex(epochKey, `${service}|${purpose}|${subject}`);
    return { pseudonym: `PSE_${policy.purposes[purpose].tag}_${mac.slice(0, 20).toUpperCase()}`, epoch, expires_ms: (epoch + 1) * ttl };
  }

  // Menerapkan kebijakan minimisasi terhadap record mentah untuk layanan tujuan tertentu.
  async function minimize({ service, record, actor = 'gateway', now = clock() }) {
    const svc = policy.services[service];
    if (!svc) throw new HttpError(400, 'UNKNOWN_SERVICE', `Layanan tujuan tidak dikenal: ${service}`);
    const projection = {};
    const tokens = [];
    for (const [name, rule] of Object.entries(svc.fields)) {
      const src = rule.source ?? name;
      const val = record[src];
      if (val === undefined || val === null) continue;
      if (rule.op === 'pass') projection[name] = val;
      else if (rule.op === 'age_band') projection[name] = ageBand(String(val), now);
      else if (rule.op === 'mask_tail') projection[name] = maskTail(val, rule.keep ?? 4);
      else if (rule.op === 'tokenize') {
        const t = derive({ subject: String(val), service, purpose: rule.purpose, now });
        projection[name] = t.pseudonym;
        tokens.push({ field: name, ...t, purpose: rule.purpose, subject: String(val) });
      }
    }
    await Promise.all(tokens.map((t) => mappings.insertIfAbsent(t.pseudonym, {
      pseudonym: t.pseudonym, service, purpose: t.purpose, epoch: t.epoch, expires_ms: t.expires_ms,
      subject_ref: subjectRef(t.subject), subject_enc: encrypt(t.subject), status: 'active', created_ms: now,
    })));
    await audit.put(newId(), {
      ts_ms: now, action: 'MINIMIZE', status: 'SUCCESS', requesting_service: service, actor,
      purpose: [...new Set(tokens.map((t) => t.purpose))].join(',') || '-', token_count: tokens.length,
    });
    return {
      projection,
      tokens: tokens.map((t) => ({ field: t.field, pseudonym: t.pseudonym, purpose: t.purpose, expires_ms: t.expires_ms })),
      policy_version: policy.version,
    };
  }

  // Membuka identitas: hanya peran yang diizinkan, layanan+tujuan PERSIS sama, belum kedaluwarsa/dicabut,
  // di bawah kuota per jam, dengan alasan tertulis & nomor kasus. Setiap percobaan (berhasil/ditolak) diaudit.
  async function reidentify({ pseudonym, requesting_service, purpose, actor, case_id, justification, now = clock() }) {
    const base = { ts_ms: now, action: 'REIDENTIFY', requesting_service, purpose, pseudonym, actor: actor.id, actor_role: actor.role, case_id };
    const deny = async (reason, status = 403, code = 'REIDENTIFY_DENIED', subject_ref) => {
      await audit.put(newId(), { ...base, status: 'DENIED', reason, justification_len: justification.length, subject_ref });
      throw new HttpError(status, code, 'Permintaan pembukaan identitas ditolak');
    };
    const roles = policy.purposes[purpose]?.reidentify_roles ?? [];
    if (!roles.includes(actor.role)) return deny('ROLE_NOT_ALLOWED');
    const used = await audit.count({ eq: { action: 'REIDENTIFY', actor: actor.id }, gte: { ts_ms: now - 3600000 } });
    if (used >= config.reidentifyMaxPerHour) return deny('QUOTA_EXCEEDED', 429, 'QUOTA_EXCEEDED');
    const m = await mappings.get(pseudonym);
    if (!m) return deny('NOT_FOUND');
    if (m.status !== 'active') return deny('REVOKED', 403, 'REIDENTIFY_DENIED', m.subject_ref);
    if (m.service !== requesting_service || m.purpose !== purpose) return deny('SERVICE_PURPOSE_MISMATCH', 403, 'REIDENTIFY_DENIED', m.subject_ref);
    if (now >= m.expires_ms) return deny('EXPIRED', 403, 'REIDENTIFY_DENIED', m.subject_ref);
    const subject = decrypt(m.subject_enc);
    await audit.put(newId(), { ...base, status: 'SUCCESS', justification_len: justification.length, subject_ref: m.subject_ref });
    return { subject_id: subject, expires_ms: m.expires_ms };
  }

  // Hak subjek data (UU PDP): cabut kemampuan re-identifikasi. Vault dihapus (crypto-shredding), token tetap ada
  // tetapi tidak akan pernah bisa dibuka lagi.
  async function revokeSubject({ subject_id, actor, now = clock() }) {
    const ref = subjectRef(subject_id);
    const list = await mappings.find({ eq: { subject_ref: ref } }, { limit: 1000 });
    for (const m of list) await mappings.update(m.pseudonym, { status: 'revoked', subject_enc: null, revoked_ms: now });
    await audit.put(newId(), { ts_ms: now, action: 'REVOKE', status: 'SUCCESS', requesting_service: 'PRIVACY', actor: actor?.id || 'unknown', subject_ref: ref, token_count: list.length });
    return { revoked: list.length };
  }

  const listAudit = (limit = 100) => audit.find({}, { orderBy: 'ts_ms', dir: 'desc', limit });

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

  return { minimize, reidentify, revokeSubject, listAudit, stats, policyView, subjectRef };
}
