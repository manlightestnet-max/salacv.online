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

export const themeChoice = () => read(KEY) || 'dark';

export function applyTheme(choice = themeChoice()) {
  document.documentElement.dataset.theme = choice === 'system' ? (light.matches ? 'light' : 'dark') : choice;
}
light.addEventListener('change', () => themeChoice() === 'system' && applyTheme());

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
