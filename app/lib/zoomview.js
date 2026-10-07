// Aperçu agrandi d'un modèle (Explorer) : la carte s'agrandit jusqu'au centre de l'écran, le CV est redessiné net
// par le vrai moteur à cette taille. Se referme par le bouton, Échap ou un clic à côté ; le focus revient sur la carte.
import { h } from '../dom.js';
import { drawDoc } from './engine.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * from : l'élément d'où part l'agrandissement (la miniature) ; doc : la page mise en page (layoutResume) ;
 * title, actions : le nom du modèle et les boutons du bas (ex. « Utiliser ce modèle »).
 */
export function openZoom({ engine, doc, from, title, sub, actions = [] }) {
  const previous = document.activeElement;
  const canvas = h('canvas', { class: 'zoom-paper', role: 'img', 'aria-label': `Aperçu du modèle ${title}` });
  const close = h('button', { type: 'button', class: 'zoom-close', 'aria-label': 'Fermer l’aperçu' }, '✕');
  const figure = h('figure', { class: 'zoom-figure' }, canvas, h('figcaption', { class: 'zoom-bar' }, h('div', { class: 'zoom-text' }, h('strong', {}, title), sub && h('small', {}, sub)), ...actions));
  const layer = h('div', { class: 'zoom-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Modèle ${title}` }, close, figure);

  // Taille : la page entière visible, sans défiler (barre du bas comprise), 640 px de large au plus.
  const width = () => Math.floor(Math.min(window.innerWidth - 32, 640, ((window.innerHeight - 150) * doc.width) / doc.height));
  const paint = () => drawDoc(engine, canvas, doc, width());
  paint();
  document.body.append(layer);
  document.documentElement.classList.add('zoom-open');

  // L'agrandissement part de la miniature (même place, même taille) puis rejoint le centre.
  if (from && !reduced()) {
    const a = from.getBoundingClientRect();
    const b = canvas.getBoundingClientRect();
    if (a.width && b.width) {
      canvas.style.transformOrigin = 'top left';
      canvas.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`;
      void canvas.offsetWidth;
      canvas.style.transition = 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
      canvas.style.transform = '';
    }
  }
  requestAnimationFrame(() => layer.classList.add('open'));
  close.focus();

  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paint, 120);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') (e.stopPropagation(), done());
    // Le focus reste dans l'aperçu (Tab tourne entre ses boutons).
    if (e.key === 'Tab') {
      const items = [close, ...figure.querySelectorAll('a, button')];
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
    }
  };
  function done() {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey, true);
    layer.classList.remove('open');
    layer.classList.add('closing');
    document.documentElement.classList.remove('zoom-open');
    setTimeout(() => layer.remove(), reduced() ? 0 : 200);
    previous?.focus?.({ preventScroll: true });
  }
  close.addEventListener('click', done);
  layer.addEventListener('click', (e) => e.target === layer && done()); // clic à côté
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey, true);
  return { close: done };
}
