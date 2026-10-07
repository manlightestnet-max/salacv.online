// Le document choisi, préparé dans le téléphone (rien n'est envoyé avant) : PDF lu par pdf.js (texte et images des
// pages, 4 pages au plus) ou photo réduite. → { mode, pages: [{ text?, image? }], pageCount }
import { chooseMode, isComplex, linesOf, textOf } from './layout.js';

export const MAX_PAGES = 4;

async function pdfjs() {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: worker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

// Une page en image JPEG, côté le plus long = side (fond blanc, comme sur papier).
async function pageImage(page, side, quality) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: side / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: g, viewport }).promise;
  const url = canvas.toDataURL('image/jpeg', quality);
  canvas.width = canvas.height = 0;
  return url;
}

/** onStep(label) : où en est la préparation (affiché à l'utilisateur). */
export async function readPdf(file, { onStep = () => {} } = {}) {
  onStep('Ouverture du PDF');
  const lib = await pdfjs();
  // Polices standard non intégrées au PDF : celles du système (rendu des images de pages).
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise;
  const count = Math.min(doc.numPages, MAX_PAGES);
  const pages = [];
  let chars = 0;
  let complex = false;
  for (let i = 1; i <= count; i++) {
    onStep(`Lecture de la page ${i} sur ${count}`);
    const page = await doc.getPage(i);
    const lines = linesOf((await page.getTextContent()).items);
    const text = textOf(lines);
    chars += text.length;
    complex ||= isComplex(lines, page.getViewport({ scale: 1 }).width);
    pages.push({ page, text });
  }
  const { mode, imageSide } = chooseMode({ chars, complex });
  if (mode !== 'text') {
    for (const [i, p] of pages.entries()) {
      onStep(`Image de la page ${i + 1} sur ${count}`);
      p.image = await pageImage(p.page, imageSide, mode === 'scan' ? 0.75 : 0.6);
    }
  }
  const pageCount = doc.numPages;
  await doc.destroy();
  return { mode, pageCount, pages: pages.map((p) => (mode === 'scan' ? { image: p.image } : mode === 'mixed' ? { text: p.text, image: p.image } : { text: p.text })) };
}

/** Photo d'un CV : une seule page, en mode scan (image nette). */
export async function readPhoto(file, { onStep = () => {} } = {}) {
  onStep('Préparation de la photo');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Photo illisible. Essaie une autre photo.');
  const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const q of [0.8, 0.65, 0.5]) {
    const image = canvas.toDataURL('image/jpeg', q);
    if (image.length < 1_500_000) return { mode: 'scan', pageCount: 1, pages: [{ image }] };
  }
  throw new Error('Photo trop lourde.');
}
