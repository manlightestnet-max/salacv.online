// Thème choisi dans un dialogue (Sombre, Clair, Système), le même sur toutes les pages.
import { h } from '../dom.js';
import { openDialog } from '../dialog.js';
import { read, write } from './store.js';

const KEY = 'salacv:theme';
const light = window.matchMedia('(prefers-color-scheme: light)');
const CHOICES = [
  { id: 'dark', label: 'Sombre' },
  { id: 'light', label: 'Clair' },
  { id: 'system', label: 'Système' },
];

export const themeChoice = () => read(KEY) || 'light';

export function applyTheme(choice = themeChoice()) {
  const t = choice === 'system' ? (light.matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = t;
  syncBrowserBar();
}

// La barre du navigateur (Chrome Android, Safari) prend la couleur du fond, dans les deux thèmes.
export function syncBrowserBar() {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) document.head.append((meta = Object.assign(document.createElement('meta'), { name: 'theme-color' })));
  const rgb = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim().split(/\s+/).join(',');
  if (rgb) meta.content = `rgb(${rgb})`;
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// Bouton lune/soleil : bascule directe Sombre ↔ Clair.
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  write(KEY, next);
  applyTheme(next);
  return next;
}
light.addEventListener('change', () => themeChoice() === 'system' && applyTheme());

// Chaque page qui charge ce module : la barre du navigateur prend tout de suite la couleur exacte du thème.
syncBrowserBar();

export function openThemePicker(onChange) {
  const buttons = CHOICES.map((c) =>
    h(
      'button',
      {
        type: 'button',
        class: 'theme-option',
        'aria-pressed': String(themeChoice() === c.id),
        onClick: () => {
          write(KEY, c.id);
          applyTheme(c.id);
          buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(CHOICES[i].id === c.id)));
          onChange?.();
        },
      },
      h('span', { class: `theme-swatch sw-${c.id}`, 'aria-hidden': 'true' }, h('i'), h('i')),
      c.label,
    ),
  );
  const dialog = openDialog({
    title: 'Thème',
    className: 'theme-dialog',
    content: h('div', { class: 'theme-options', role: 'group', 'aria-label': 'Thème' }, buttons),
    footer: [h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => dialog.close() }, 'Terminé')],
  });
}
