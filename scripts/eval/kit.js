// Menjalankan eval-kit (Luche/healthkathon-eval-kit) yang di-clone DI LUAR repo. Lokasi: env EVALKIT_DIR, default ../healthkathon-eval-kit.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../shared/config.js';

export const kitDir = () => path.resolve(process.env.EVALKIT_DIR || path.join(ROOT, '..', 'healthkathon-eval-kit'));
const kitPython = (dir) => ['.venv/Scripts/python.exe', '.venv/bin/python'].map((p) => path.join(dir, p)).find((p) => fs.existsSync(p)) ?? (process.platform === 'win32' ? 'python' : 'python3');

// Mengembalikan { ran, reason?, html, md, stdout, limitations[] }. limitations = temuan keterbatasan otomatis dari kit, apa adanya.
export function runKit({ evalkitDir, out, seed }) {
  const dir = kitDir();
  if (!fs.existsSync(path.join(dir, 'hkeval'))) return { ran: false, reason: `eval-kit tidak ditemukan di ${dir}. Clone https://github.com/Luche/healthkathon-eval-kit ke lokasi itu (di luar repo).` };
  const args = ['-m', 'hkeval', 'evaluate', '--scores', path.join(evalkitDir, 'scores.csv'), '--truth', path.join(evalkitDir, 'truth.csv'), '--capacity', '0.01',
    '--strata', 'level,region', '--data-source', 'synthetic', '--lang', 'id', '--entity-noun', 'klaim', '--group-noun', 'pasien', '--seed', String(seed), '--out', out];
  const r = spawnSync(kitPython(dir), args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) return { ran: false, reason: `hkeval gagal (kode ${r.status}): ${(r.stderr || r.stdout || '').slice(-600)}`, stdout: r.stdout };
  const mdFile = out.replace(/\.html$/, '.md');
  const md = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, 'utf8') : '';
  return { ran: true, html: out, md, stdout: r.stdout, limitations: extractLimitations(md) };
}

// Mengambil butir dari bagian keterbatasan pada kartu bukti (heading yang memuat "Keterbatasan"/"Limitation"/"Batas").
export function extractLimitations(md) {
  const lines = md.split('\n'); const out = []; let on = false;
  for (const ln of lines) {
    if (/^#{1,4}\s/.test(ln)) on = /keterbatasan|limitation|batas|caveat/i.test(ln);
    else if (on && /^\s*([-*]|\d+\.)\s+/.test(ln)) out.push(ln.replace(/^\s*([-*]|\d+\.)\s+/, '').trim());
  }
  return out;
}
