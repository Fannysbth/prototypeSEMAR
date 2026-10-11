// Menjalankan seluruh microservice sebagai proses terpisah (lintas OS, tanpa Docker/shell khusus).
// Dipakai oleh `npm start` (scripts/dev.js) dan oleh skrip evaluasi/tes.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getConfig, ROOT } from '../shared/config.js';

const SERVICES = [
  { name: 'auth', file: 'services/auth/index.js' },
  { name: 'privacy', file: 'services/privacy/index.js' },
  { name: 'claims', file: 'services/claims/index.js' },
  { name: 'notify', file: 'services/notify/index.js' },
  { name: 'fraud', file: 'services/fraud/index.js' },
  { name: 'gateway', file: 'services/gateway/index.js' },
];

async function waitHealthy(url, child, name, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Layanan "${name}" berhenti saat start (kode ${child.exitCode}). Lihat log di atas.`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Layanan "${name}" tidak siap dalam ${Math.round(timeoutMs / 1000)} detik.`);
}

export async function startStack({ env = {}, quiet = false, timeoutMs = 90000, onCrash } = {}) {
  Object.assign(process.env, env);
  const config = getConfig();
  const children = [];
  let stopping = false;

  const launch = (svc) => {
    const child = spawn(process.execPath, [path.join(ROOT, svc.file)], { cwd: ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!quiet) {
      child.stdout.on('data', (d) => process.stdout.write(d));
      child.stderr.on('data', (d) => process.stderr.write(d));
    } else {
      child.stdout.resume(); child.stderr.resume();
    }
    child.on('exit', (code) => { if (!stopping && code !== 0 && code !== null) onCrash?.(svc.name, code); });
    children.push({ svc, child });
    return child;
  };

  const stop = async () => {
    stopping = true;
    await Promise.all(children.map(({ child }) => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 4000).unref();
      return undefined;
    })));
  };

  try {
    const backend = SERVICES.filter((s) => s.name !== 'gateway');
    await Promise.all(backend.map((svc) => waitHealthy(`${config.urls[svc.name]}/health`, launch(svc), svc.name, timeoutMs)));
    const gw = SERVICES.find((s) => s.name === 'gateway');
    await waitHealthy(`http://127.0.0.1:${config.ports.gateway}/health`, launch(gw), 'gateway', timeoutMs);
  } catch (err) {
    await stop();
    throw err;
  }
  return { config, stop, baseUrl: `http://127.0.0.1:${config.ports.gateway}` };
}
