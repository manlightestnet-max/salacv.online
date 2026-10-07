// Tirer pour actualiser (mobile, appli installée comprise) : en haut de la page, tirer vers le bas fait apparaître
// une pastille qui tourne ; relâchée assez bas, la page relit ses données. Discret, et sans effet si l'on fait défiler.
import { h } from '../dom.js';

const PULL = 72; // distance (px) à tirer pour lancer l'actualisation

export function initPullRefresh(refresh) {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  const dot = h('div', { class: 'ptr', 'aria-hidden': 'true' }, h('span'));
  document.body.append(dot);
  let startY = null;
  let pulled = 0;
  let busy = false;
  const set = (d) => {
    pulled = d;
    dot.style.setProperty('--d', `${Math.min(d, PULL * 1.4)}px`);
    dot.style.setProperty('--r', `${Math.min(1, d / PULL) * 300}deg`);
    dot.classList.toggle('ready', d >= PULL);
  };
  window.addEventListener(
    'touchstart',
    (e) => {
      const blocked = e.target.closest?.('.dialog-backdrop, input, textarea, [contenteditable]');
      startY = !busy && !blocked && window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (startY === null) return;
      const d = (e.touches[0].clientY - startY) * 0.55;
      if (d <= 0 || window.scrollY > 0) return set(0);
      dot.classList.add('on');
      set(d);
    },
    { passive: true },
  );
  window.addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    if (pulled < PULL) {
      dot.classList.remove('on');
      return set(0);
    }
    busy = true;
    dot.classList.add('spin');
    set(PULL);
    try {
      await refresh();
    } finally {
      busy = false;
      dot.classList.remove('spin', 'on', 'ready');
      set(0);
    }
  });
}
