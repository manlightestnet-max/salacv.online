// Import de CV : un seul appel à l'IA, le mode le moins cher (texte seul / images + texte / scan), compte obligatoire,
// réponse vérifiée (preuves dans le texte du PDF). Aucun réseau : modèle simulé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkImport, importCv, MAX_PAGES } from '../server/cvimport/extract.js';
import { CVS } from './fixtures/import-cvs.js';
import { chooseMode, isComplex, linesOf, textOf } from '../app/import/layout.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const answering = (json, seen = []) => {
  const model = async (messages, opts) => (seen.push({ messages, opts }), { choices: [{ message: { content: typeof json === 'string' ? json : `\`\`\`json\n${JSON.stringify(json)}\n\`\`\`` } }] });
  model.seen = seen;
  return model;
};

test('compte obligatoire', async () => {
  const out = await importCv({ mode: 'text', pages: [{ text: CVS[0].text }] }, { callModel: answering(CVS[0].ai) });
  assert.equal(out.status, 401);
});

test('contrôles : mode, pages, texte ou images selon le mode', () => {
  assert.equal(checkImport({ mode: 'x', pages: [{ text: 'a' }] }).ok, false);
  assert.equal(checkImport({ mode: 'text', pages: [] }).ok, false);
  assert.equal(checkImport({ mode: 'text', pages: Array(MAX_PAGES + 1).fill({ text: CVS[0].text }) }).ok, false);
  assert.equal(checkImport({ mode: 'text', pages: [{ text: 'trop court' }] }).ok, false);
  assert.equal(checkImport({ mode: 'scan', pages: [{ text: '' }] }).ok, false);
  assert.equal(checkImport({ mode: 'scan', pages: [{ image: 'data:text/html;base64,PGI+' }] }).ok, false);
  assert.equal(checkImport({ mode: 'mixed', pages: [{ text: CVS[1].text, image: PNG }] }).ok, true);
});

test('mode texte : sans image ni vision, chaque valeur prouvée', async () => {
  const model = answering(CVS[0].ai);
  const out = await importCv({ mode: 'text', pages: [{ text: CVS[0].text }] }, { callModel: model, username: 'ana' });
  assert.equal(out.ok, true);
  assert.equal(model.seen.length, 1);
  assert.equal(model.seen[0].opts.vision, false);
  assert.equal(typeof model.seen[0].messages[0].content, 'string');
  assert.equal(out.candidate.proven, true);
  assert.deepEqual(out.candidate.verify, []);
  assert.equal(out.candidate.state.profile.name, 'MOUKALA Prisca');
});

test('mode colonnes : images pour la structure + texte, les erreurs de lecture sont à vérifier', async () => {
  const model = answering(CVS[1].ai);
  const out = await importCv({ mode: 'mixed', pages: [{ text: CVS[1].text, image: PNG }] }, { callModel: model, username: 'ana' });
  assert.equal(model.seen[0].opts.vision, true);
  const parts = model.seen[0].messages[0].content;
  assert.ok(parts.some((p) => p.type === 'image_url'));
  assert.ok(parts.some((p) => p.type === 'text' && p.text.includes('TEXTE DU PDF')));
  assert.deepEqual(out.candidate.verify, CVS[1].expectVerify);
});

test('scan : images seules, rien n’est présenté comme prouvé', async () => {
  const model = answering({ profile: { name: 'Awa Mboungou', email: 'awa@' }, experiences: [{ title: 'Caissière', org: 'Casino' }], uncertain: ['experiences.0.org'] });
  const out = await importCv({ mode: 'scan', pages: [{ image: PNG }] }, { callModel: model, username: 'ana' });
  assert.equal(out.candidate.proven, false);
  assert.deepEqual(out.candidate.verify, ['experiences.0.org', 'profile.email']);
  assert.ok(!JSON.stringify(model.seen[0].messages).includes('TEXTE DU PDF'));
});

test('réponse sans JSON : une seule relance ; pas un CV : refus clair', async () => {
  const seen = [];
  let n = 0;
  const flaky = async (messages, opts) => (seen.push(messages), { choices: [{ message: { content: n++ === 0 ? 'Voici le CV de Prisca !' : JSON.stringify(CVS[0].ai) } }] });
  const out = await importCv({ mode: 'text', pages: [{ text: CVS[0].text }] }, { callModel: flaky, username: 'ana' });
  assert.equal(out.ok, true);
  assert.equal(seen.length, 2);
  const notCv = await importCv({ mode: 'text', pages: [{ text: 'Facture n° 2026-118 · Total 45 000 FCFA · Merci de votre achat chez nous.' }] }, { callModel: answering({ profile: {}, uncertain: [] }), username: 'ana' });
  assert.equal(notCv.status, 422);
});

// Texte pdf.js simulé : x, y (repère PDF, y vers le haut), largeur.
const item = (str, x, y, width = str.length * 5) => ({ str, transform: [1, 0, 0, 1, x, y], width });

test('mise en page : lignes reconstituées, colonnes détectées, mode le moins cher', () => {
  const single = linesOf([item('Prisca', 50, 800), item('MOUKALA', 90, 800.5), item('Comptable junior', 50, 780), item('Licence', 50, 760), item('Stage', 50, 740)]);
  assert.equal(textOf(single), ['Prisca MOUKALA', 'Comptable junior', 'Licence', 'Stage'].join('\n'));
  assert.equal(isComplex(single, 595), false);
  const cols = linesOf(['Contact', '06 543 21 09', 'jb@yahoo.fr', 'Pointe-Noire'].flatMap((s, i) => [item(s, 40, 700 - i * 20, 60), item(`Expérience ${i}`, 330, 700 - i * 20, 120)]));
  assert.equal(isComplex(cols, 595), true);
  assert.deepEqual(chooseMode({ chars: 50, complex: false }), { mode: 'scan', imageSide: 1600 });
  assert.equal(chooseMode({ chars: 3000, complex: true }).mode, 'mixed');
  assert.equal(chooseMode({ chars: 3000, complex: false }).mode, 'text');
});

test('vrai PDF lu par pdf.js : le texte et le mode, comme dans le téléphone', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = ['MOUKALA Prisca', 'Comptable junior', 'prisca.moukala@gmail.com  +242 06 612 34 56', 'Licence en comptabilite et finance, Universite Marien Ngouabi', 'Stagiaire comptable, Cabinet Ngoma et Associes', 'Saisie des pieces comptables et rapprochements bancaires'];
  lines.forEach((t, i) => page.drawText(t, { x: 50, y: 790 - i * 22, size: 12, font }));
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await lib.getDocument({ data: await pdf.save(), isEvalSupported: false }).promise;
  const p1 = await doc.getPage(1);
  const read = linesOf((await p1.getTextContent()).items);
  const text = textOf(read);
  assert.ok(text.includes('MOUKALA Prisca'));
  assert.ok(text.includes('+242 06 612 34 56'));
  assert.equal(isComplex(read, p1.getViewport({ scale: 1 }).width), false);
  assert.equal(chooseMode({ chars: text.length, complex: false }).mode, 'text');
  await doc.destroy();
});
