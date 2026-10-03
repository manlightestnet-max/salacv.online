// Moteur partagé par toutes les pages (landing, studio, dashboard) : CanvasKit + polices,
// chargés une seule fois. drawDoc peint une page d'un layout dans un <canvas>.
import CanvasKitInit from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import { loadFontSet } from '../../src/index.js';
import { createSkiaRenderer } from '../../src/render/skia.js';

const fontUrls = import.meta.glob('../../fonts/*.ttf', { query: '?url', import: 'default', eager: true });

let loading = null;

export function loadEngine() {
  loading ??= Promise.all([
    CanvasKitInit({ locateFile: () => wasmUrl }),
    loadFontSet((file) =>
      fetch(fontUrls[`../../fonts/${file}`]).then((r) => {
        if (!r.ok) throw new Error(`police ${file} : HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ),
  ]).then(([CK, fonts]) => ({ CK, fonts, skia: createSkiaRenderer(CK, fonts) }));
  return loading;
}

// Peint la page `index` de `doc` dans `canvas`, à la largeur CSS `width`.
// La surface est gardée sur le canvas et recréée seulement si la taille change.
export function drawDoc(engine, canvas, doc, width, index = 0) {
  if (!(width > 0)) return; // élément pas encore mis en page
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = (width / doc.width) * dpr;
  const bw = Math.round(doc.width * scale);
  const bh = Math.round(doc.height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${Math.round((doc.height * width) / doc.width)}px`;
  if (!canvas._surface || canvas.width !== bw || canvas.height !== bh) {
    canvas._surface?.delete();
    canvas.width = bw;
    canvas.height = bh;
    canvas._surface = engine.CK.MakeSWCanvasSurface(canvas);
  }
  if (!canvas._surface) return;
  engine.skia.drawPage(canvas._surface.getCanvas(), doc, index, scale);
  canvas._surface.flush();
}
