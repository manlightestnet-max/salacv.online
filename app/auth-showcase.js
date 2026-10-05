// Page de connexion, grand écran : les modèles défilent en trois colonnes (vrai moteur, comme la landing).
// Chargé à part et après la page : la connexion est utilisable tout de suite, même sans le moteur (7 Mo).
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { drawDoc, loadEngine } from './lib/engine.js';
import { TEMPLATES } from './state.js';

const PAPER_WIDTH = 220;

const paper = (el) => (el.classList.add('auth-paper'), el);

export async function showTemplates(root) {
  // Colonnes remplies d'emplacements gris tout de suite, remplacés par les CV dès que le moteur est prêt.
  const columns = [[], [], []];
  TEMPLATES.forEach((t, i) => columns[i % 3].push(t));
  const slots = new Map();
  root.replaceChildren(
    ...columns.map((list) => {
      const col = document.createElement('div');
      col.className = 'auth-col';
      // Deux fois la même suite : la boucle (translateY -50 %) ne saute jamais.
      for (const round of [0, 1]) {
        for (const t of list) {
          const empty = paper(document.createElement('div'));
          empty.classList.add('is-empty');
          col.append(empty);
          slots.set(`${t.id}:${round}`, empty);
        }
      }
      return col;
    }),
  );

  const engine = await loadEngine();
  const canvas = document.createElement('canvas');
  for (const t of TEMPLATES) {
    const r = layoutResume({ ...example, template: t.id }, engine.fonts);
    if (!r.ok) continue;
    drawDoc(engine, canvas, r.doc, PAPER_WIDTH);
    const src = canvas.toDataURL('image/png'); // une image par modèle : une seule surface de dessin pour tous
    for (const round of [0, 1]) {
      const img = paper(Object.assign(document.createElement('img'), { src, alt: '', decoding: 'async' }));
      slots.get(`${t.id}:${round}`)?.replaceWith(img);
    }
    await new Promise((resolve) => requestAnimationFrame(resolve)); // laisse respirer l'animation entre deux rendus
  }
  canvas._surface?.delete();
}
