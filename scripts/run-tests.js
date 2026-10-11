// Menjalankan semua tes (node:test bawaan Node, tanpa dependensi tambahan) secara lintas-OS.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', cwd: root });
child.on('exit', (code) => process.exit(code ?? 1));
