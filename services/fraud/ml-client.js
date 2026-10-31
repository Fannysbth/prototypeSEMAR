// Klien layanan ml. Gagal/mati -> melempar galat (engine memakai aturan saja); setelah gagal, dilewati 10 detik
// supaya klaim berikutnya tidak menunggu timeout.
const TOKEN = /^PSE_[A-Z]{3}_[0-9A-F]{20}$/; // mode baseline mengirim NIK mentah sebagai fraud_ref: jangan diteruskan ke ml
export function createMlClient(config, { timeoutMs = 2000, backoffMs = 10000 } = {}) {
  let downUntil = 0;
  return {
    // ids: { subject_token, faskes_id } (token dan id faskes saja; tanpa PII)
    async score(features, ids = {}) {
      if (Date.now() < downUntil) throw new Error('ml dilewati sementara');
      try {
        const res = await fetch(`${config.urls.ml}/score`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': config.secrets.INTERNAL_API_KEY },
          body: JSON.stringify({ subject_token: TOKEN.test(ids.subject_token ?? '') ? ids.subject_token : undefined, faskes_id: ids.faskes_id, features }), signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`ml ${res.status}`);
        return await res.json();
      } catch (err) { downUntil = Date.now() + backoffMs; throw err; }
    },
  };
}
