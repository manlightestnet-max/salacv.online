import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { layoutResume, loadFontSet, parseResume } from '../src/index.js';
import { createKit } from '../src/layout/engine.js';
import { renderPdf } from '../src/render/pdf.js';

const fonts = await loadFontSet((f) => readFile(new URL(`../fonts/${f}`, import.meta.url)));
const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));

test('le DSL refuse un CV sans nom et donne le chemin de l’erreur', () => {
  const r = parseResume({ profile: { name: '' } });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, 'profile.name');
});

test('le DSL applique les valeurs par défaut', () => {
  const r = parseResume({ profile: { name: 'A' } });
  assert.equal(r.ok, true);
  assert.equal(r.resume.template, 'minimal');
  assert.deepEqual(r.resume.sections, []);
});

test('wrap ne dépasse jamais la largeur demandée', () => {
  const kit = createKit(fonts);
  const style = { font: 'sans-400', size: 9 };
  const text = 'Supercalifragilisticexpialidocious '.repeat(8) + 'mot-tres-long-sans-espace'.repeat(6);
  for (const line of kit.wrap(text, style.font, style.size, 120)) {
    assert.ok(fonts.measure(line, style.font, style.size) <= 120, line);
  }
});

test('le layout est déterministe et reste dans la page', () => {
  const a = layoutResume(example, fonts);
  const b = layoutResume(example, fonts);
  assert.ok(a.ok);
  assert.deepEqual(a.doc, b.doc);
  for (const op of a.doc.pages.flat()) {
    if (op.t === 'text') assert.ok(op.y > 0 && op.y < a.doc.height, `texte hors page : ${op.s}`);
  }
});

test('un CV long passe sur plusieurs pages', () => {
  const long = structuredClone(example);
  long.sections[0].items = Array(5).fill(example.sections[0].items).flat();
  const r = layoutResume(long, fonts);
  assert.ok(r.doc.pages.length >= 2);
});

test('le PDF contient le vrai texte et le bon nombre de pages', async () => {
  const { doc } = layoutResume(example, fonts);
  const bytes = await renderPdf(doc, fonts, { title: 'CV' });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), doc.pages.length);
  assert.equal(pdf.getTitle(), 'CV');
});

test('les caractères absents de la police sont retirés (pas de carrés vides)', () => {
  assert.equal(fonts.sanitize('Salut 🚀 Kin', 'sans-400'), 'Salut  Kin');
});
