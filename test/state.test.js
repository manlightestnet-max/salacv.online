import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState, toResume, fromResume, checklist } from '../app/state.js';
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

test('une ligne par point, compétences séparées par des virgules', () => {
  const s = emptyState();
  s.profile.name = 'A';
  s.experiences[0] = { title: 'Stage', org: '', location: '', period: '', bullets: 'Un\n\n  Deux  ' };
  s.skills[0] = { label: 'Outils', items: 'Figma, , Git ' };
  const [exp, tags] = toResume(s).sections;
  assert.deepEqual(exp.items[0].bullets, ['Un', 'Deux']);
  assert.deepEqual(tags.groups[0].items, ['Figma', 'Git']);
});

test('la vérification bloque sans nom ni contact', () => {
  const levels = checklist(emptyState()).map((c) => c.level);
  assert.equal(levels.filter((l) => l === 'todo').length, 3);
});
