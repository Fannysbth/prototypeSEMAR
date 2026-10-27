// Membuat ulang reports/evaluation.md, data-card.md, dan blok hasil README dari reports/metrics.json (tanpa mengulang evaluasi).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../shared/config.js';
import { dataCardMd, evaluationMd } from './eval/report.js';
import { renderReadme } from './render-readme.js';

const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'metrics.json'), 'utf8'));
fs.writeFileSync(path.join(ROOT, 'reports', 'evaluation.md'), evaluationMd(metrics));
fs.writeFileSync(path.join(ROOT, 'reports', 'data-card.md'), dataCardMd(metrics));
renderReadme();
console.log('evaluation.md, data-card.md, README.md dibuat ulang dari metrics.json');
