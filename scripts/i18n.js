// i18n/cv.csv (à éditer dans Excel ou Google Sheets) → src/i18n/labels.json.
// Une ligne = une clé, une colonne = une langue. Case vide : on retombe sur le français.
//   npm run i18n
import { readFileSync, writeFileSync } from 'node:fs';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function csvToLabels(text) {
  const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  const langs = head.slice(1).map((l) => l.trim());
  const out = Object.fromEntries(langs.map((l) => [l, {}]));
  for (const [key, ...values] of rows) langs.forEach((l, i) => values[i]?.trim() && (out[l][key.trim()] = values[i].trim()));
  return out;
}

if (process.argv[1]?.endsWith('i18n.js')) {
  const labels = csvToLabels(readFileSync(new URL('../i18n/cv.csv', import.meta.url), 'utf8'));
  writeFileSync(new URL('../src/i18n/labels.json', import.meta.url), `${JSON.stringify(labels, null, 2)}\n`);
  console.log(`labels : ${Object.keys(labels).join(', ')}`);
}
