// ALUR KASUS TANPA MEMBUKA IDENTITAS (T4). Verifikator menilai dari pola token; bila butuh bukti ia meminta berkas ke faskes
// lewat nomor klaim, dan bila butuh identitas ia mengeskalasi ke auditor (satu-satunya yang boleh reveal).
// Semua langkah tercatat di case_events (Fraud Service) dan audit berantai hash (Privacy Service).
import crypto from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../../shared/http.js';

export const MAX_ATTACHMENT_BYTES = 200 * 1024;
export const REPLY_PATH = /\/file-requests\/[^/]+\/reply$/;
const note = z.string().trim().min(5, 'catatan minimal 5 karakter').max(500);
export const requestSchema = z.object({ note }).strict();
export const escalateSchema = z.object({ note }).strict();
export const replySchema = z.object({
  note,
  attachment: z.object({ name: z.string().regex(/^[\w.\- ]{1,80}\.(pdf|png|jpe?g|txt)$/i, 'lampiran harus pdf, png, jpg, atau txt'), content_base64: z.string().max(290000) }).strict().optional(),
}).strict();

const MAGIC = {
  pdf: (b) => b.subarray(0, 4).toString() === '%PDF',
  png: (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG',
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
  txt: () => true,
};
const short = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function createWorkflow({ clients, requests }) {
  const noPii = async (text) => {
    const { hits } = await clients.privacy.screen(text);
    if (hits.length) throw new HttpError(400, 'PII_IN_TEXT', `Teks memuat data pribadi (${hits.join(', ')}). Tulis tanpa nama atau NIK; gunakan nomor klaim.`);
  };
  const audit = (action, user, target, reason, requestId) => clients.privacy.event({ action, actor: user.sub, role: user.role, target, reason: short(reason, 400) }, requestId);
  const forFacility = (r) => ({
    request_id: r.request_id, claim_id: r.claim_id, note: r.note, status: r.status, created_ms: r.created_ms,
    reply: r.reply ? { note: r.reply.note, at_ms: r.reply.at_ms, attachment: r.reply.attachment ? { name: r.reply.attachment.name, size: r.reply.attachment.size } : null } : null,
  });
  const forStaff = (r) => ({ ...forFacility(r), case_id: r.case_id, facility_id: r.facility_id, requested_by: r.requested_by });

  async function requestFile({ caseId, body, user, requestId }) {
    const { note: text } = requestSchema.parse(body);
    await noPii(text);
    const c = await clients.fraud.getCase(caseId);
    const doc = { request_id: `REQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, case_id: c.case_id, claim_id: c.claim_id, facility_id: c.facility_id, note: text, status: 'MENUNGGU', requested_by: user.sub, created_ms: Date.now(), reply: null };
    await requests.put(doc.request_id, doc);
    await clients.fraud.setStatus(c.case_id, { status: 'MENUNGGU_FASKES', note: short(`Minta berkas ke ${c.facility_id} (${doc.request_id}): ${text}`), actor: user.sub });
    await audit('FILE_REQUEST', user, c.case_id, `${doc.request_id} ke ${c.facility_id} untuk klaim ${c.claim_id}`, requestId);
    return forStaff(doc);
  }

  async function list({ user, caseId }) {
    const filter = user.role === 'facility' ? { eq: { facility_id: user.facility_id } } : (caseId ? { eq: { case_id: caseId } } : {});
    const rows = await requests.find(filter, { orderBy: 'created_ms', dir: 'desc', limit: 200 });
    return rows.map(user.role === 'facility' ? forFacility : forStaff);
  }

  async function reply({ id, body, user, requestId }) {
    const r = await requests.get(id);
    if (!r || r.facility_id !== user.facility_id) throw new HttpError(404, 'NOT_FOUND', 'Permintaan tidak ditemukan');
    if (r.status === 'DIBALAS') throw new HttpError(409, 'ALREADY_REPLIED', 'Permintaan ini sudah dibalas');
    const b = replySchema.parse(body);
    await noPii(b.note);
    let attachment = null;
    if (b.attachment) {
      const bytes = Buffer.from(b.attachment.content_base64, 'base64');
      if (bytes.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'ATTACHMENT_TOO_LARGE', 'Lampiran maksimal 200 KB');
      const ext = b.attachment.name.split('.').pop().toLowerCase();
      if (!MAGIC[ext](bytes)) throw new HttpError(400, 'ATTACHMENT_TYPE_MISMATCH', 'Isi lampiran tidak sesuai ekstensinya');
      if (ext === 'txt') await noPii(bytes.toString('utf8'));
      attachment = { name: b.attachment.name, size: bytes.length, content_base64: b.attachment.content_base64 };
    }
    const updated = await requests.update(id, { status: 'DIBALAS', reply: { note: b.note, at_ms: Date.now(), by: user.sub, attachment } });
    await clients.fraud.setStatus(r.case_id, { status: 'DITINJAU', note: short(`Faskes membalas ${id}: ${b.note}`), actor: user.sub });
    await audit('FILE_REPLY', user, r.case_id, `${id} dibalas${attachment ? ` dengan lampiran ${attachment.name} (${attachment.size} byte)` : ''}`, requestId);
    return forFacility(updated);
  }

  async function attachment(id) {
    const r = await requests.get(id);
    const a = r?.reply?.attachment;
    if (!a) throw new HttpError(404, 'NOT_FOUND', 'Lampiran tidak ditemukan');
    return { name: a.name, bytes: Buffer.from(a.content_base64, 'base64') };
  }

  async function escalate({ caseId, body, user, requestId }) {
    const { note: text } = escalateSchema.parse(body);
    await noPii(text);
    const c = await clients.fraud.getCase(caseId);
    const updated = await clients.fraud.setStatus(c.case_id, { status: 'ESKALASI', note: short(`Eskalasi ke auditor: ${text}`), actor: user.sub });
    await audit('CASE_ESCALATE', user, c.case_id, text, requestId);
    return { case_id: c.case_id, status: updated.status };
  }

  return { requestFile, list, reply, attachment, escalate };
}
