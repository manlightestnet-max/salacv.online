import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState, normalizeState, emptyItem, toResume, fromResume, checklist, sortRecentFirst, hasGhost, SECTION_TITLES } from '../app/state.js';
import { parseResume } from '../src/index.js';

const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));

test("un formulaire vide montre l'exemple entier en grisé", () => {
  const r = parseResume(toResume(emptyState(), { mockup: example }));
  assert.ok(r.ok);
  assert.deepEqual(r.resume.profile.ghost, ['name', 'title', 'summary', 'contact']);
  assert.equal(r.resume.profile.name, example.profile.name);
  assert.ok(r.resume.sections.length === example.sections.length && r.resume.sections.every((s) => s.ghost));
  assert.ok(hasGhost(r.resume));
});

test("ce que l'étudiant saisit remplace l'exemple, partie par partie", () => {
  const s = emptyState();
  s.profile.name = 'Patrick Ilunga';
  s.profile.phones = ['+242 06 000 0000'];
  s.skills = ['Excel'];
  const r = parseResume(toResume(s, { mockup: example })).resume;
  assert.equal(r.profile.name, 'Patrick Ilunga');
  assert.deepEqual(r.profile.ghost, ['title', 'summary']);
  assert.equal(r.profile.email, undefined, "pas d'email de l'exemple quand un contact est saisi");
  const skills = r.sections.find((x) => x.title === SECTION_TITLES.skills);
  assert.deepEqual(skills, { type: 'bullets', title: SECTION_TITLES.skills, items: ['Excel'] });
  assert.ok(r.sections.filter((x) => x !== skills).every((x) => x.ghost));
});

test("le PDF (sans mockup) ne contient jamais l'exemple", () => {
  const r = toResume(emptyState());
  assert.deepEqual(r.sections, []);
  assert.equal(r.profile.ghost, undefined);
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
  s.profile.phones = ['+242 06 000 0000', ' ', '+242 05 000 0000'];
  s.education[0] = { ...emptyItem(), title: 'Licence', details: 'Un\n\n  Deux  ' };
  s.skills = ['Excel', '', 'Anglais '];
  s.hobbies = ['Football'];
  const r = toResume(s);
  assert.deepEqual(r.profile.phones, ['+242 06 000 0000', '+242 05 000 0000']);
  assert.deepEqual(r.sections[0].items[0].bullets, ['Un', 'Deux']);
  assert.deepEqual(r.sections[1], { type: 'bullets', title: SECTION_TITLES.skills, items: ['Excel', 'Anglais'] });
  assert.deepEqual(r.sections[2].items, ['Football']);
});

test('la vérification bloque sans nom, profession, contact ni formation', () => {
  const levels = checklist(emptyState()).map((c) => c.level);
  assert.equal(levels.filter((l) => l === 'todo').length, 4);
});

test('un ancien brouillon (compétences en texte) est converti en listes', () => {
  const s = normalizeState({ profile: { name: 'A', phones: ['', '+242 06'] }, skills: 'Excel\nWord', hobbies: 'Football', languages: [{ name: 'Lingala', level: 'Natif' }] });
  assert.deepEqual(s.skills, ['Excel', 'Word']);
  assert.deepEqual(s.hobbies, ['Football']);
  assert.deepEqual(s.profile.phones, ['+242 06']);
  assert.equal(s.languages[0].name, 'Lingala');
  assert.deepEqual(s.education, emptyState().education);
});
