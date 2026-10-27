// CSV minimal (RFC 4180): kolom dikutip, koma/baris baru di dalam kutip, "" sebagai kutip.
export function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') endCell();
    else if (c === '\n') endRow();
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) endRow();
  const [head, ...body] = rows;
  if (!head) return [];
  const cols = head.map((h) => h.trim().replace(/^﻿/, ''));
  return body.map((r) => Object.fromEntries(cols.map((k, i) => [k, r[i] ?? ''])));
}

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows, cols) => `${[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')}\n`;
