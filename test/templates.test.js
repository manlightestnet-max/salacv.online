// Chaque template : layout + PDF avec l'exemple, en mode exemple grisé, sans photo,
// et avec un CV presque vide. Aucun texte ne doit sortir de la page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { layoutResume, loadFontSet } from '../src/index.js';
import { templates } from '../src/templates/index.js';
import { renderPdf } from '../src/render/pdf.js';
import { emptyState, toResume, TEMPLATES } from '../app/state.js';

const fonts = await loadFontSet((f) => readFile(new URL(`../fonts/${f}`, import.meta.url)));
const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));
// Petite image PNG valide (1×1 px) comme photo.
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('les modèles proposés dans l’app existent tous dans le moteur', () => {
  assert.deepEqual(TEMPLATES.map((t) => t.id).sort(), Object.keys(templates).sort());
});

for (const id of Object.keys(templates)) {
  test(`template ${id} : exemple, photo, mode exemple, CV vide`, async () => {
    const cases = {
      complet: { ...example, template: id, profile: { ...example.profile, photo: PHOTO } },
      'sans photo': { ...example, template: id },
      'mode exemple': { ...toResume(emptyState(), { mockup: example }), template: id },
      vide: { template: id, profile: { name: 'A' } },
    };
    for (const [label, input] of Object.entries(cases)) {
      const r = layoutResume(input, fonts, { watermark: 'aperçu' });
      assert.ok(r.ok, `${label} : ${JSON.stringify(r.errors)}`);
      for (const op of r.doc.pages.flat()) {
        if (op.t !== 'text' || op.rotate) continue;
        assert.ok(op.x >= 0 && op.x < r.doc.width && op.y > 0 && op.y < r.doc.height, `${label} : texte hors page « ${op.s} »`);
      }
      const pdf = await PDFDocument.load(await renderPdf(r.doc, fonts));
      assert.equal(pdf.getPageCount(), r.doc.pages.length, label);
    }
  });
}

test('DSL des modèles : un modèle JSON se dessine comme les autres', async () => {
  const { templateFromSpec } = await import('../src/templates/spec.js');
  const { registerTemplate } = await import('../src/templates/index.js');
  registerTemplate(templateFromSpec({ id: 'test-dsl', name: 'Test', header: 'title', heading: 'dot', paper: 'lined', colors: { accent: '#0F766E' } }));
  const r = layoutResume({ ...example, template: 'test-dsl' }, fonts);
  assert.equal(r.ok, true);
  assert.ok(r.doc.pages[0].length > 50);
});

test('skill des agents : ses exemples JSON sont acceptés par le DSL', async () => {
  const { parseTemplateSpec } = await import('../src/templates/spec.js');
  const md = await readFile(new URL('../skills/salacv-modele-cv/SKILL.md', import.meta.url), 'utf8');
  const lines = md.split('\n').filter((l) => l.startsWith('{ "id"'));
  const block = md.match(/```json\n(\{[\s\S]*?\})\n```/)[1];
  for (const json of [block, ...lines]) assert.equal(parseTemplateSpec(JSON.parse(json)).ok, true, json);
  assert.ok(lines.length >= 5);
});
