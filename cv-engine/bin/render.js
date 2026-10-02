#!/usr/bin/env node
// Rend un CV JSON en PDF (vectoriel) et en PNG (Skia), pour tester le moteur.
// Usage : node bin/render.js examples/etudiant.json [dossier-sortie] [--watermark]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CanvasKitInit from 'canvaskit-wasm';
import { layoutResume, loadFontSet } from '../src/index.js';
import { createSkiaRenderer } from '../src/render/skia.js';
import { renderPdf } from '../src/render/pdf.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const watermark = args.includes('--watermark');
const [input, outDir = 'out'] = args.filter((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage : node bin/render.js <cv.json> [dossier-sortie] [--watermark]');
  process.exit(1);
}

const fonts = await loadFontSet((file) => readFile(path.join(root, 'fonts', file)));
const result = layoutResume(JSON.parse(await readFile(input, 'utf8')), fonts, {
  watermark: watermark ? 'salacv.online · aperçu' : undefined,
});
if (!result.ok) {
  console.error('CV invalide :');
  for (const e of result.errors) console.error(`  ${e.path || '(racine)'} : ${e.message}`);
  process.exit(1);
}

const { doc, resume } = result;
const base = path.basename(input, '.json');
await mkdir(outDir, { recursive: true });

const pdf = await renderPdf(doc, fonts, { title: `CV — ${resume.profile.name}`, author: resume.profile.name });
await writeFile(path.join(outDir, `${base}.pdf`), pdf);

const CK = await CanvasKitInit();
const skia = createSkiaRenderer(CK, fonts);
const scale = 2;
for (let i = 0; i < doc.pages.length; i++) {
  const surface = CK.MakeSurface(Math.ceil(doc.width * scale), Math.ceil(doc.height * scale));
  skia.drawPage(surface.getCanvas(), doc, i, scale);
  const png = surface.makeImageSnapshot().encodeToBytes();
  await writeFile(path.join(outDir, `${base}-p${i + 1}.png`), png);
  surface.delete();
}

console.log(`${doc.pages.length} page(s) -> ${outDir}/${base}.pdf (+ PNG Skia)`);
