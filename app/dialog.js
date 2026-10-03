// Fenêtre de dialogue : feuille qui monte du bas sur mobile, fenêtre centrée sur PC.
// Échap, le fond ou « Annuler » la ferment ; le focus revient où il était.
import { h } from './dom.js';

let uid = 0;

// content : nœud(s) ; footer : nœud(s) en bas (boutons). Retourne { el, close }.
export function openDialog({ title, content, footer, onClose, className = '' }) {
  const id = `dlg${++uid}`;
  const previous = document.activeElement;
  const panel = h(
    'section',
    { class: `dialog ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
    h('div', { class: 'dialog-grip', 'aria-hidden': 'true' }, h('span')),
    h('header', { class: 'dialog-head' }, h('h2', { id }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onClick: () => close() }, '✕')),
    h('div', { class: 'dialog-body' }, content),
    footer && h('footer', { class: 'dialog-foot' }, footer),
  );
  const backdrop = h('div', { class: 'dialog-backdrop', onClick: (e) => e.target === backdrop && close() }, panel);

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 180);
    previous?.focus?.({ preventScroll: true });
    onClose?.();
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  requestAnimationFrame(() => panel.querySelector('[data-autofocus], button:not(.icon-btn), input')?.focus({ preventScroll: true }));
  return { el: panel, close };
}
