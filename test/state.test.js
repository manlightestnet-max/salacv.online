import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState, emptyItem, toResume, fromResume, checklist, sortRecentFirst, SECTION_TITLES } from '../app/state.js';
import { parseResume } from '../src/index.js';

const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));

test('un formulaire vide donne un CV valide avec le nom provisoire', () => {
  const r = parseResume(toResume(emptyState(), { placeholderName: 'Ton nom' }));
  assert.ok(r.ok);
  assert.equal(r.resume.profile.name, 'Ton nom');
  assert.deepEqual(r.resume.sections, []);
});

test("l'exemple fait l'aller-retour formulaire -> DSL sans perte", () => {
  const back = parseResume(toResume(fromResume(example)));
  assert.ok(back.ok);
  assert.deepEqual(back.resume, parseResume(example).resume);
});

test('les sections suivent l’ordre du CV congolais', () => {
  const titles = toResume(fromResume(example)).sections.map((s) => s.title);
  assert.deepEqual(titles, Object.values(SECTION_TITLES));
});

test('formations et expériences classées du plus récent au plus ancien', () => {
  const periods = ['2018 — 2019', '2024 — aujourd’hui', '', 'Juin — Sept. 2025', '2019 — 2023', '2024'];
  const sorted = sortRecentFirst(periods.map((period) => ({ period }))).map((i) => i.period);
  assert.deepEqual(sorted, ['2024 — aujourd’hui', 'Juin — Sept. 2025', '2024', '2019 — 2023', '2018 — 2019', '']);
});

test('une ligne par détail, compétence et loisir ; plusieurs téléphones', () => {
  const s = emptyState();
  s.profile.name = 'A';
  s.profile.phones = ['+243 81 000 0000', ' ', '+243 99 000 0000'];
  s.education[0] = { ...emptyItem(), title: 'Licence', details: 'Un\n\n  Deux  ' };
  s.skills = 'Excel\n\nAnglais ';
  s.hobbies = 'Football';
  const r = toResume(s);
  assert.deepEqual(r.profile.phones, ['+243 81 000 0000', '+243 99 000 0000']);
  assert.deepEqual(r.sections[0].items[0].bullets, ['Un', 'Deux']);
  assert.deepEqual(r.sections[1], { type: 'bullets', title: SECTION_TITLES.skills, items: ['Excel', 'Anglais'] });
  assert.deepEqual(r.sections[2].items, ['Football']);
});

test('la vérification bloque sans nom, profession, contact ni formation', () => {
  const levels = checklist(emptyState()).map((c) => c.level);
  assert.equal(levels.filter((l) => l === 'todo').length, 4);
});
