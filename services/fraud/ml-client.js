// Klien layanan ml. Gagal/mati -> melempar galat (engine memakai aturan saja); setelah gagal, dilewati 10 detik
// supaya klaim berikutnya tidak menunggu timeout.
export function createMlClient(config, { timeoutMs = 800, backoffMs = 10000 } = {}) {
  let downUntil = 0;
  return {
    async score(features) {
      if (Date.now() < downUntil) throw new Error('ml dilewati sementara');
      try {
        const res = await fetch(`${config.urls.ml}/score`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': config.secrets.INTERNAL_API_KEY },
          body: JSON.stringify({ features }), signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`ml ${res.status}`);
        return await res.json();
      } catch (err) { downUntil = Date.now() + backoffMs; throw err; }
    },
  };
}
