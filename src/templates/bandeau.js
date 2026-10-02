// Template "bandeau" : bandeau de couleur en haut (nom en capitales, profession),
// photo encadrée, colonne latérale (contact, compétences, langues, loisirs) et
// colonne principale (profil, formation, expérience) aux titres soulignés.
// Contenu au format CV congolais ; le contenu `ghost` (exemple) est grisé.
import { label } from '../i18n/index.js';
import { block } from '../layout/engine.js';

const C = {
  band: '#8FA3CC', // bleu doux du bandeau
  ink: '#1F2A44', // profession, sur le bandeau
  text: '#1A1A1A',
  soft: '#333333',
  muted: '#6B7280',
  rule: '#E5E7EB',
  white: '#FFFFFF',
};
export const DEFAULT_ACCENT = '#2D4A8A'; // titres de section

const PAGE = { width: 595.28, height: 841.89 };
const BAND_H = 104;
const SIDE = { x: 28, w: 150 };
const MAIN_X = 212;
const DIVIDER_X = 194;
const M = { top: 50, bottom: 50, left: MAIN_X, right: 30, firstTop: BAND_H + 26 };

function fade(hex, t = 0.6) {
  const n = parseInt(hex.slice(1), 16);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function styles(accent, ghost) {
  const c = (hex) => (ghost ? fade(hex) : hex);
  return {
    name: { font: 'sans-600', size: 22, color: C.white, tracking: -0.2 },
    title: { font: 'sans-600', size: 11, color: c(C.ink), tracking: 0.2 },
    sideHead: { font: 'sans-500', size: 10.5, color: accent, tracking: 0.3 },
    side: { font: 'sans-400', size: 8.3, color: c(C.text) },
    sideMuted: { font: 'sans-400', size: 8.3, color: c(C.muted) },
    mainHead: { font: 'sans-500', size: 11, color: accent, tracking: 0.3 },
    para: { font: 'sans-400', size: 8.6, color: c(C.soft) },
    itemHead: { font: 'sans-600', size: 8.8, color: c(C.text) },
    detail: { font: 'sans-400', size: 8.4, color: c(C.soft) },
    line: c(C.text),
  };
}

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

export const bandeau = {
  id: 'bandeau',
  margin: M,

  // Colonne principale : profil, formation, expérience, texte libre.
  build(resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const S = styles(accent, false);
    const G = styles(accent, true);
    const p = resume.profile;
    const W = PAGE.width - MAIN_X - M.right;
    const blocks = [];

    function heading(title) {
      const ops = [];
      const h = kit.paragraph(ops, title.toUpperCase(), MAIN_X, 0, W, S.mainHead, 15);
      ops.push({ t: 'line', x1: MAIN_X, y1: h + 2, x2: MAIN_X + W * 0.82, y2: h + 2, color: C.rule, lw: 0.9 });
      return block(ops, h + 10, { keepWithNext: true });
    }

    function paragraphs(body, st) {
      const ops = [];
      let y = 0;
      body.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
        if (i) y += 8;
        y += kit.paragraph(ops, line, MAIN_X, y, W, st.para, 12.5);
      });
      return block(ops, y, { gapAfter: 22 });
    }

    // « 2024 — 2025 | Titre — Organisation » en gras souligné, puis une ligne par détail.
    function item(it, st, last) {
      const ops = [];
      const head = [it.period && `${it.period} | `, it.title, it.org && ` — ${it.org}`, it.location && `, ${it.location}`].filter(Boolean).join('');
      const lines = kit.wrap(head, st.itemHead.font, st.itemHead.size, W);
      let y = 0;
      for (const line of lines) {
        const base = kit.baseline(y, st.itemHead, 13);
        kit.text(ops, line, MAIN_X, base, st.itemHead);
        ops.push({ t: 'line', x1: MAIN_X, y1: base + 2, x2: MAIN_X + kit.width(line, st.itemHead), y2: base + 2, color: st.line, lw: 0.6 });
        y += 13;
      }
      if (it.bullets.length) y += 4;
      for (const d of it.bullets) y += kit.paragraph(ops, d, MAIN_X + 12, y, W - 12, st.detail, 12.5);
      return block(ops, y, { gapAfter: last ? 22 : 10 });
    }

    if (p.summary) blocks.push(heading(label(resume.lang, 'label.profilePro')), paragraphs(p.summary, p.ghost.includes('summary') ? G : S));
    for (const section of resume.sections) {
      const st = section.ghost ? G : S;
      if (section.type === 'timeline' && section.items.length) {
        blocks.push(heading(section.title), ...section.items.map((it, i) => item(it, st, i === section.items.length - 1)));
      } else if (section.type === 'text') {
        blocks.push(heading(section.title), paragraphs(section.body, st));
      }
    }
    return blocks;
  },

  // Bandeau, photo, colonne latérale (page 1) et filet vertical (toutes les pages),
  // dessinés sous le contenu.
  decorate(doc, resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const S = styles(accent, false);
    const G = styles(accent, true);
    const p = resume.profile;
    const ghosted = (f) => p.ghost.includes(f);

    doc.pages.forEach((ops, i) => {
      const decor = [];
      const top = i === 0 ? BAND_H + 6 : 40;
      decor.push({ t: 'line', x1: DIVIDER_X, y1: top, x2: DIVIDER_X, y2: PAGE.height - 36, color: C.rule, lw: 1 });
      decor.push({ t: 'line', x1: DIVIDER_X + 1.5, y1: top, x2: DIVIDER_X + 1.5, y2: PAGE.height - 36, color: '#F3F4F6', lw: 1.5 });
      if (i === 0) decor.unshift(...firstPage());
      ops.unshift(...decor);
    });

    function firstPage() {
      const ops = [];
      const band = resume.theme.accent ? fade(resume.theme.accent, 0.45) : C.band;
      ops.push({ t: 'rect', x: 0, y: 0, w: PAGE.width, h: BAND_H, fill: band });

      // Nom et profession sur le bandeau.
      const nameStyle = ghosted('name') ? { ...S.name, opacity: 0.6 } : S.name;
      const textW = PAGE.width - MAIN_X - M.right;
      let y = 22;
      y += kit.paragraph(ops, p.name.toUpperCase(), MAIN_X, y, textW, nameStyle, 27);
      // En mode exemple, texte du bandeau en blanc translucide : un gris serait illisible sur le bleu.
      const titleStyle = ghosted('title') ? { ...S.title, color: C.white, opacity: 0.6 } : S.title;
      if (p.title) kit.paragraph(ops, p.title.toUpperCase(), MAIN_X, y + 4, Math.min(textW, 300), titleStyle, 14);

      // Photo encadrée (ou initiales), à cheval sur le bandeau.
      const frame = { x: SIDE.x + 3, y: 34, s: 124 };
      ops.push({ t: 'rect', x: frame.x, y: frame.y, w: frame.s, h: frame.s, fill: C.white, stroke: accent, lw: 1.6 });
      const d = frame.s - 16;
      const px = frame.x + 8;
      const py = frame.y + 8;
      if (doc.images.photo) {
        ops.push({ t: 'image', x: px, y: py, w: d, h: d, r: d / 2, src: 'photo' });
      } else {
        ops.push({ t: 'circle', cx: px + d / 2, cy: py + d / 2, r: d / 2, fill: '#E8ECF5' });
        const ini = initials(p.name) || '?';
        const st = { font: 'sans-600', size: 30, color: band };
        kit.text(ops, ini, px + (d - kit.width(ini, st)) / 2, py + d / 2 + kit.baseline(0, st, 0), st);
      }

      // Colonne latérale.
      let sy = frame.y + frame.s + 28;
      const sideHead = (title) => {
        sy += kit.paragraph(ops, title.toUpperCase(), SIDE.x, sy, SIDE.w, S.sideHead, 14) + 4;
      };
      const bullet = (runs, st) => {
        kit.text(ops, '•', SIDE.x, kit.baseline(sy, st, 12), st);
        sy += kit.rich(ops, runs, SIDE.x + 7, sy, SIDE.w - 7, 12);
      };

      const contactStyle = (ghosted('contact') ? G : S).side;
      const contacts = [p.address, ...p.phones, p.email, ...p.links.map((l) => l.label)].filter(Boolean);
      if (contacts.length) {
        sideHead(label(resume.lang, 'label.contact'));
        for (const c of contacts) sy += kit.paragraph(ops, c, SIDE.x, sy, SIDE.w, contactStyle, 12);
        sy += 18;
      }
      for (const section of resume.sections) {
        const st = section.ghost ? G : S;
        if (section.type === 'bullets' && section.items.length) {
          sideHead(section.title);
          for (const it of section.items) bullet([{ s: it, style: st.side }], st.side);
          sy += 18;
        } else if (section.type === 'list' && section.items.length) {
          sideHead(section.title);
          for (const it of section.items) bullet([{ s: it.name, style: st.side }, ...(it.level ? [{ s: ` — ${it.level}`, style: st.sideMuted }] : [])], st.side);
          sy += 18;
        }
      }
      return ops;
    }
  },
};
