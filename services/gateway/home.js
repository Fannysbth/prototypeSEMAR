// BERANDA PER PERAN dan daftar klaim ter-token. Semua hanya memuat token, nomor klaim, dan angka: tidak ada identitas.
import { z } from 'zod';

const DAY = 86400000;
const OPEN = new Set(['BARU', 'DITINJAU', 'BUTUH_INFO', 'MENUNGGU_FASKES', 'ESKALASI']);
const caseRow = (c) => ({
  case_id: c.case_id, claim_id: c.claim_id, risk_score: c.risk_score, risk_level: c.risk_level, modi: c.modi, facilities: c.facilities, status: c.status,
  diagnosis_code: c.diagnosis_code, amount: c.amount, potensi_nilai_dipertanyakan: c.potensi_nilai_dipertanyakan, created_ms: c.created_ms,
});
const countBy = (arr, keyOf) => arr.reduce((acc, x) => { for (const k of [].concat(keyOf(x))) acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function createHome({ clients, uploader, workflow, config, serviceStatus }) {
  async function facility(user) {
    const batches = await uploader.listBy(user.sub);
    const rows = batches.reduce((s, b) => s + b.total, 0); const accepted = batches.reduce((s, b) => s + b.accepted, 0);
    const errs = countBy(batches.flatMap((b) => b.errors), (e) => e.message);
    return {
      role: 'facility',
      uploads: batches.slice(0, 10).map((b) => ({ batch_id: b.batch_id, status: b.status, total: b.total, accepted: b.accepted, rejected: b.rejected, created_ms: b.created_ms })),
      quality: {
        total_rows: rows, accepted, rejected: rows - accepted, accepted_pct: rows ? +((accepted / rows) * 100).toFixed(1) : null,
        top_errors: Object.entries(errs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([message, count]) => ({ message, count })),
      },
      file_requests: (await workflow.list({ user })).filter((r) => r.status === 'MENUNGGU'),
    };
  }

  async function verifier() {
    const { items } = await clients.fraud.cases('?limit=2000');
    const open = items.filter((c) => OPEN.has(c.status));
    const now = Date.now();
    const events = (await clients.fraud.events(15)).items;
    return {
      role: 'verifier',
      queue: [...open].sort((a, b) => b.risk_score - a.risk_score || b.created_ms - a.created_ms).slice(0, 10).map(caseRow),
      open_total: open.length,
      new_today: items.filter((c) => c.created_ms >= startOfToday()).length,
      by_modus: countBy(open, (c) => c.modi),
      age: { lt_1d: open.filter((c) => now - c.created_ms < DAY).length, d1_3: open.filter((c) => now - c.created_ms >= DAY && now - c.created_ms < 3 * DAY).length, gt_3: open.filter((c) => now - c.created_ms >= 3 * DAY).length },
      activity: events.map((e) => ({ at_ms: e.at_ms, case_id: e.case_id, actor: e.actor, from_status: e.from_status, to_status: e.to_status, note: e.note })),
    };
  }

  async function auditor(user) {
    const { items } = await clients.fraud.cases('?status=ESKALASI&limit=200');
    const audit = (await clients.privacy.audit(500)).items;
    return {
      role: 'auditor',
      escalated: items.map(caseRow),
      my_reveals: audit.filter((a) => a.action === 'REIDENTIFY' && a.actor === user.sub).slice(0, 20)
        .map((a) => ({ seq: a.seq, ts_ms: a.ts_ms, action: a.action, actor: a.actor, case_id: a.case_id, status: a.status, reason: a.reason ?? null })),
    };
  }

  async function admin() {
    const [services, chain, audit] = await Promise.all([serviceStatus(), clients.privacy.auditVerify(), clients.privacy.audit(500)]);
    const now = Date.now(); const usage = {};
    for (const a of audit.items.filter((x) => x.action === 'REIDENTIFY')) {
      const u = (usage[a.actor] ??= { actor: a.actor, last_hour: 0, last_day: 0 });
      if (now - a.ts_ms < 3600000) u.last_hour += 1;
      if (now - a.ts_ms < DAY) u.last_day += 1;
    }
    return {
      role: 'admin', services, audit: { valid: chain.valid, entries: chain.entries },
      quota: { max_per_hour: config.reidentifyMaxPerHour, max_per_day: config.reidentifyMaxPerDay, usage: Object.values(usage) },
      recent_audit: audit.items.slice(0, 10).map((a) => ({ seq: a.seq, ts_ms: a.ts_ms, action: a.action, actor: a.actor ?? null, status: a.status, case_id: a.case_id ?? null })),
    };
  }

  const build = (user) => ({ facility: () => facility(user), verifier, auditor: () => auditor(user), admin }[user.role]());

  // ---- daftar klaim ter-token ----
  const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const querySchema = z.object({
    q: z.string().trim().max(64).optional(), facility: z.string().max(20).optional(), diagnosis: z.string().max(10).optional(), status: z.string().regex(/^[A-Z_]+$/).optional(),
    from: isoDate.optional(), to: isoDate.optional(), min_score: z.coerce.number().int().min(0).max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(100),
  }).strict();
  const partial = (t) => (/^PSE_[A-Z]{3}_[0-9A-F]{20}$/.test(t) ? `${t.slice(0, 14)}...` : '(tanpa token)');

  async function tokenized(query) {
    const f = querySchema.parse(query);
    const [{ items: scores }, { items: cases }] = await Promise.all([clients.fraud.scores(), clients.fraud.cases('?limit=2000')]);
    const statusOf = new Map(cases.map((c) => [c.case_id, c.status]));
    const q = f.q?.toLowerCase();
    const rows = scores.map((s) => ({
      claim_id: s.claim_id, token: partial(s.fraud_ref), facility_id: s.facility_id, admit_date: s.admit_date, diagnosis_code: s.diagnosis_code, amount: s.amount,
      score: s.score, risk_level: s.risk_level, case_id: s.case_id, status: s.case_id ? (statusOf.get(s.case_id) ?? 'BARU') : 'TANPA_KASUS',
      _ref: s.fraud_ref.toLowerCase(),
    })).filter((r) => (!q || r.claim_id.toLowerCase().includes(q) || r._ref.includes(q)) && (!f.facility || r.facility_id === f.facility) && (!f.diagnosis || r.diagnosis_code === f.diagnosis)
      && (!f.status || r.status === f.status) && (!f.from || r.admit_date >= f.from) && (!f.to || r.admit_date <= f.to) && (f.min_score === undefined || r.score >= f.min_score));
    return { total: rows.length, items: rows.slice(0, f.limit).map(({ _ref, ...r }) => r) };
  }

  return { build, tokenized };
}
