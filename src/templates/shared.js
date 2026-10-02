// Outils communs aux templates : couleurs, photo, puces dessinées, contacts.
import { label, LANGS } from '../i18n/index.js';

// Mélange une couleur vers le blanc (contenu d'exemple « ghost », bandeaux clairs).
export function fade(hex, t = 0.58) {
  const n = parseInt(hex.slice(1), 16);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// Applique `fade` aux couleurs d'un jeu de styles quand le contenu est un exemple.
export function tone(styles, ghost, keep = []) {
  if (!ghost) return styles;
  return Object.fromEntries(
    Object.entries(styles).map(([k, v]) => {
      if (keep.includes(k)) return [k, v];
      if (typeof v === 'string' && v.startsWith('#')) return [k, fade(v)];
      if (v && typeof v === 'object' && v.color) return [k, { ...v, color: fade(v.color) }];
      return [k, v];
    }),
  );
}

export const initials = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

// Photo de l'étudiant (op `image`, rognée selon r) ou, sans photo, ses initiales.
export function photo(ops, kit, resume, { x, y, w, h, r = 0, bg = '#E5E7EB', ink = '#6B7280', size = 28 }) {
  if (resume.profile.photo) {
    ops.push({ t: 'image', x, y, w, h, r, src: 'photo' });
    return;
  }
  if (r >= Math.min(w, h) / 2) ops.push({ t: 'circle', cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2, fill: bg });
  else ops.push({ t: 'rect', x, y, w, h, r, fill: bg });
  const st = { font: 'sans-600', size, color: ink };
  const text = initials(resume.profile.name);
  kit.text(ops, text, x + (w - kit.width(text, st)) / 2, y + h / 2 + kit.baseline(0, st, 0), st);
}

// Coche dessinée (Geist n'a pas le glyphe ✓). (x, y) = coin haut gauche, s = taille.
export function check(ops, x, y, s, color) {
  ops.push({ t: 'line', x1: x, y1: y + s * 0.55, x2: x + s * 0.38, y2: y + s * 0.9, color, lw: 1 });
  ops.push({ t: 'line', x1: x + s * 0.38, y1: y + s * 0.9, x2: x + s, y2: y + s * 0.1, color, lw: 1 });
}

export function diamond(ops, cx, cy, r, fill) {
  ops.push({ t: 'poly', points: [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], fill });
}

// Niveau de langue → nombre de points sur 5 (barres et pastilles des templates).
// Toutes les langues du tableau i18n/cv.csv : « Native », « Fluent »… comptent aussi.
const SCORES = { Natif: 5, Courant: 4, Professionnel: 4, Intermédiaire: 3, Notions: 2 };
const LEVEL = { intermediaire: 3 };
for (const [fr, score] of Object.entries(SCORES)) for (const lang of LANGS) LEVEL[label(lang, `level.${fr}`).toLowerCase()] = score;
export const levelScore = (level) => LEVEL[String(level ?? '').trim().toLowerCase()] ?? 0;

// Contacts dans l'ordre d'un CV : [{ label, value }].
export function contactList(p, lang = 'fr') {
  return [
    p.address && { label: label(lang, 'label.address'), value: p.address },
    ...p.phones.map((v, i) => ({ label: i ? '' : label(lang, 'label.phone'), value: v })),
    p.email && { label: label(lang, 'label.email'), value: p.email },
    ...p.links.map((l) => ({ label: label(lang, 'label.link'), value: l.label })),
  ].filter(Boolean);
}

// Nom en deux lignes : prénom, puis le reste (« Nicolas / Thomas »).
export function splitName(name) {
  const words = String(name ?? '').trim().split(/\s+/);
  return words.length < 2 ? [words[0] ?? ''] : [words[0], words.slice(1).join(' ')];
}

// Sections réparties entre colonne principale et colonne latérale.
export const mainSections = (resume) => resume.sections.filter((s) => s.type === 'timeline' || s.type === 'text');
export const sideSections = (resume) => resume.sections.filter((s) => s.type === 'bullets' || s.type === 'list');
