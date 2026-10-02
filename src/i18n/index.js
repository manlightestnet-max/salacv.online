// Libellés du CV par langue (générés depuis i18n/cv.csv par `npm run i18n`).
import labels from './labels.json' with { type: 'json' };

export const LANGS = Object.keys(labels);
export const DEFAULT_LANG = 'fr';

// Libellé `key` dans `lang`, sinon en français.
export function label(lang, key) {
  return labels[lang]?.[key] ?? labels[DEFAULT_LANG][key] ?? key;
}

export const langName = (lang) => label(lang, 'lang.name');
