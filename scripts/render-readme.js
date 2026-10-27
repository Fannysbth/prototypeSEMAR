// Mengganti blok antara <!-- HASIL:START --> dan <!-- HASIL:END --> di README.md dengan angka dari reports/metrics.json.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../shared/config.js';
import { readmeBlock } from './eval/report.js';

export function renderReadme() {
  const file = path.join(ROOT, 'README.md');
  const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'metrics.json'), 'utf8'));
  const text = fs.readFileSync(file, 'utf8');
  const next = text.replace(/<!-- HASIL:START -->[\s\S]*?<!-- HASIL:END -->/, () => `<!-- HASIL:START -->\n${readmeBlock(metrics)}\n<!-- HASIL:END -->`);
  fs.writeFileSync(file, next);
  return next !== text;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(renderReadme() ? 'README.md diperbarui dari reports/metrics.json' : 'README.md sudah sesuai');
