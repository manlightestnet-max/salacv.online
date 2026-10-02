import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod, parsePeriod } from '../app/period.js';
import { sortRecentFirst } from '../app/state.js';

test('format des périodes, comme sur les CV de référence', () => {
  assert.equal(formatPeriod({ start: { y: 2023 }, end: { y: 2026 } }), '2023 — 2026');
  assert.equal(formatPeriod({ start: { y: 2024 }, end: null }), '2024');
  assert.equal(formatPeriod({ start: { y: 2025, m: 5 }, end: { y: 2025, m: 8 } }), 'Juin — Sept. 2025');
  assert.equal(formatPeriod({ start: { y: 2023, m: 8 }, end: { y: 2025, m: 5 } }), 'Sept. 2023 — Juin 2025');
  assert.equal(formatPeriod({ start: { y: 2024 }, end: 'now' }), "2024 — aujourd'hui");
  assert.equal(formatPeriod({ start: { y: 2024, m: 0 }, end: { y: 2024, m: 0 } }), 'Janv. 2024');
  assert.equal(formatPeriod({ start: null, end: null }), '');
});

test('relecture d’une période pour rouvrir le sélecteur', () => {
  for (const text of ['2023 — 2026', 'Juin — Sept. 2025', 'Sept. 2023 — Juin 2025', "2024 — aujourd'hui", '2024', 'Janv. 2024']) {
    assert.equal(formatPeriod(parsePeriod(text)), text, text);
  }
});

test('les périodes du sélecteur se trient du plus récent au plus ancien', () => {
  const items = ['2019 — 2023', "2024 — aujourd'hui", 'Juin — Sept. 2025', '2018'].map((period) => ({ period }));
  assert.deepEqual(sortRecentFirst(items).map((i) => i.period), ["2024 — aujourd'hui", 'Juin — Sept. 2025', '2019 — 2023', '2018']);
});
