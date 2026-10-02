// Démo navigateur : JSON -> aperçu Skia live -> export PDF.
import CanvasKitInit from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import { layoutResume, loadFontSet } from '../src/index.js';
import { createSkiaRenderer } from '../src/render/skia.js';
import example from '../examples/etudiant.json';

const fontUrls = import.meta.glob('../fonts/*.ttf', { query: '?url', import: 'default', eager: true });
const fontUrl = (file) => fontUrls[`../fonts/${file}`];

const $ = (id) => document.getElementById(id);
const source = $('source');
const status = $('status');
const canvases = $('canvases');
const exportBtn = $('export');
const watermark = $('watermark');

const WATERMARK = 'salacv.online · aperçu';
const DRAFT_KEY = 'salacv:draft';

const [CK, fonts] = await Promise.all([
  CanvasKitInit({ locateFile: () => wasmUrl }),
  loadFontSet((file) => fetch(fontUrl(file)).then((r) => r.arrayBuffer())),
]);
const skia = createSkiaRenderer(CK, fonts);

let current = null; // dernier layout valide
let surfaces = [];

source.value = readDraft() ?? JSON.stringify(example, null, 2);
render();

let timer;
source.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(render, 120);
});
watermark.addEventListener('change', render);
exportBtn.addEventListener('click', exportPdf);
window.addEventListener('resize', () => current && paint(current.doc));

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    exportPdf();
  }
  // Tab insère une indentation au lieu de quitter l'éditeur.
  if (e.key === 'Tab' && e.target === source) {
    e.preventDefault();
    source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end');
    source.dispatchEvent(new Event('input'));
  }
});

function render() {
  let data;
  try {
    data = JSON.parse(source.value);
  } catch (err) {
    return setStatus(`JSON invalide : ${err.message}`, true);
  }
  const t0 = performance.now();
  const result = layoutResume(data, fonts, { watermark: watermark.checked ? WATERMARK : undefined });
  if (!result.ok) {
    return setStatus(result.errors.map((e) => `${e.path || '(racine)'} : ${e.message}`).join('\n'), true);
  }
  current = result;
  paint(result.doc);
  saveDraft(source.value);
  setStatus(`OK · ${result.doc.pages.length} page(s) · layout + rendu en ${Math.round(performance.now() - t0)} ms`);
}

function paint(doc) {
  const zoom = Math.min(1.25, (canvases.clientWidth - 48) / doc.width);
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(doc.width * zoom);
  const h = Math.round(doc.height * zoom);

  // Recrée les surfaces seulement si le nombre de pages ou la taille change.
  if (surfaces.length !== doc.pages.length || surfaces[0]?.w !== w) {
    surfaces.forEach((s) => s.surface.delete());
    canvases.replaceChildren();
    surfaces = doc.pages.map(() => {
      const el = document.createElement('canvas');
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      canvases.append(el);
      return { surface: CK.MakeCanvasSurface(el), w };
    });
  }
  $('pages').textContent = `/ ${String(doc.pages.length).padStart(2, '0')}`;

  doc.pages.forEach((_, i) => {
    const { surface } = surfaces[i];
    skia.drawPage(surface.getCanvas(), doc, i, zoom * dpr);
    surface.flush();
  });
}

async function exportPdf() {
  if (!current) return;
  exportBtn.disabled = true;
  try {
    const { doc, resume } = current;
    const { renderPdf } = await import('../src/render/pdf.js');
    const bytes = await renderPdf(doc, fonts, { title: `CV — ${resume.profile.name}`, author: resume.profile.name });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `CV-${slug(resume.profile.name)}.pdf` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    exportBtn.disabled = false;
  }
}

function setStatus(msg, error = false) {
  status.textContent = msg;
  status.classList.toggle('error', error);
}

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function saveDraft(value) {
  try {
    localStorage.setItem(DRAFT_KEY, value);
  } catch {
    // stockage indisponible (navigation privée) : on ignore
  }
}
