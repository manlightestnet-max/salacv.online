// Template "marine" : colonne bleu marine (photo ronde, profil, compétences, langues
// avec barre de niveau, centres d'intérêt) ; à droite le nom en grand sur deux lignes,
// la profession, les contacts, puis expérience et formation.
import { label } from '../i18n/index.js';
import { block } from '../layout/engine.js';
import { contactList, levelScore, mainSections, photo, sideSections, splitName, tone } from './shared.js';

export const DEFAULT_ACCENT = '#1E3A8A';
const PAGE = { width: 595.28, height: 841.89 };
const SIDE = { w: 196, pad: 20 };
const X = 220;
const W = PAGE.width - X - 30;
const M = { top: 40, bottom: 46, left: X, right: 30 };

function styles(accent, ghost) {
  return tone(
    {
      name: { font: 'sans-600', size: 29, color: accent, tracking: -0.4 },
      job: { font: 'sans-400', size: 10, color: '#4B5563', tracking: 0.8 },
      contact: { font: 'sans-400', size: 8.4, color: '#374151' },
      head: { font: 'sans-600', size: 11.5, color: accent, tracking: 0.5 },
      period: { font: 'sans-500', size: 8, color: '#111111' },
      title: { font: 'sans-600', size: 9.2, color: '#111111' },
      org: { font: 'sans-400', size: 8.6, color: '#374151' },
      body: { font: 'sans-400', size: 8.4, color: '#374151' },
      mark: accent,
      dot: '#111111',
    },
    ghost,
    ['head', 'mark'],
  );
}

// Colonne : texte blanc (atténué pour le contenu d'exemple).
function sideStyles(ghost) {
  const o = ghost ? 0.55 : 1;
  return {
    head: { font: 'sans-600', size: 10.5, color: '#FFFFFF', tracking: 0.6 },
    text: { font: 'sans-400', size: 8.3, color: '#FFFFFF', opacity: 0.92 * o },
    strong: { font: 'sans-600', size: 8.6, color: '#FFFFFF', opacity: o },
    muted: { font: 'sans-400', size: 8, color: '#C7D2FE', opacity: o },
    opacity: o,
  };
}

export const marine = {
  id: 'marine',
  margin: M,

  build(resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const p = resume.profile;
    const S = styles(accent, false);
    const G = styles(accent, true);
    const blocks = [];

    {
      const ops = [];
      let y = 0;
      for (const line of splitName(p.name)) y += kit.paragraph(ops, line, X, y, W, (p.ghost.includes('name') ? G : S).name, 31);
      if (p.title) y += 4 + kit.paragraph(ops, p.title.toUpperCase(), X, y + 4, W, (p.ghost.includes('title') ? G : S).job, 14);
      y += 12;
      const c = p.ghost.includes('contact') ? G : S;
      for (const item of contactList(p, resume.lang)) {
        ops.push({ t: 'rect', x: X, y: y + 4, w: 5, h: 5, r: 1, fill: c.mark });
        y += kit.paragraph(ops, item.value, X + 13, y, W - 13, c.contact, 13);
      }
      blocks.push(block(ops, y, { gapAfter: 20 }));
    }

    for (const section of mainSections(resume)) {
      const s = section.ghost ? G : S;
      const head = [];
      const h = kit.paragraph(head, section.title.toUpperCase(), X, 0, W, S.head, 15);
      head.push({ t: 'line', x1: X, y1: h + 2, x2: X + W, y2: h + 2, color: accent, lw: 0.8 });
      blocks.push(block(head, h + 12, { keepWithNext: true }));
      if (section.type === 'text') {
        const ops = [];
        blocks.push(block(ops, kit.paragraph(ops, section.body, X, 0, W, s.body, 12.5), { gapAfter: 18 }));
        continue;
      }
      section.items.forEach((it, i) => {
        const ops = [];
        let y = 0;
        if (it.period) y += kit.paragraph(ops, it.period, X, y, W, s.period, 11.5);
        y += kit.paragraph(ops, it.title, X, y, W, s.title, 13);
        const place = [it.org, it.location].filter(Boolean).join(' | ');
        if (place) y += kit.paragraph(ops, place, X, y, W, s.org, 12);
        if (it.bullets.length) y += 3;
        for (const d of it.bullets) {
          ops.push({ t: 'circle', cx: X + 4, cy: y + 6, r: 1.3, fill: s.dot });
          y += kit.paragraph(ops, d, X + 11, y, W - 11, s.body, 12);
        }
        blocks.push(block(ops, y, { gapAfter: i === section.items.length - 1 ? 18 : 11 }));
      });
    }
    return blocks;
  },

  decorate(doc, resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const p = resume.profile;

    doc.pages.forEach((ops, i) => {
      const decor = [{ t: 'rect', x: 0, y: 0, w: SIDE.w, h: PAGE.height, fill: accent }];
      if (i === 0) decor.push(...sidebar());
      ops.unshift(...decor);
    });

    function sidebar() {
      const ops = [];
      const x = SIDE.pad;
      const w = SIDE.w - SIDE.pad * 2;
      const d = 128;
      const cx = SIDE.w / 2;
      ops.push({ t: 'circle', cx, cy: 30 + d / 2, r: d / 2 + 3, fill: '#FFFFFF' });
      photo(ops, kit, resume, { x: cx - d / 2, y: 30, w: d, h: d, r: d / 2, bg: '#DBE3F7', ink: accent, size: 34 });
      let y = 30 + d + 26;

      const head = (title) => {
        y += kit.paragraph(ops, title.toUpperCase(), x, y, w, sideStyles(false).head, 14);
        ops.push({ t: 'line', x1: x, y1: y + 3, x2: x + w, y2: y + 3, color: '#FFFFFF', lw: 0.6 });
        y += 12;
      };

      if (p.summary) {
        const s = sideStyles(p.ghost.includes('summary'));
        head(label(resume.lang, 'label.profile'));
        p.summary.split('\n').filter((l) => l.trim()).forEach((line, i) => {
          if (i) y += 4;
          y += kit.paragraph(ops, line.trim(), x, y, w, s.text, 12);
        });
        y += 18;
      }

      for (const section of sideSections(resume)) {
        const s = sideStyles(section.ghost);
        head(section.title);
        for (const item of section.items) {
          if (typeof item === 'string') {
            ops.push({ t: 'circle', cx: x + 3, cy: y + 6, r: 1.4, fill: '#FFFFFF', opacity: s.opacity });
            y += kit.paragraph(ops, item, x + 10, y, w - 10, s.text, 12) + 1;
            continue;
          }
          // Langue : nom en gras, niveau en texte, barre de niveau.
          y += kit.paragraph(ops, item.name, x, y, w, s.strong, 12.5);
          if (item.level) y += kit.paragraph(ops, item.level, x, y, w, s.muted, 11.5);
          const score = levelScore(item.level);
          ops.push({ t: 'rect', x, y: y + 2, w, h: 2.5, r: 1.2, fill: '#4F67B3' });
          if (score) ops.push({ t: 'rect', x, y: y + 2, w: (w * score) / 5, h: 2.5, r: 1.2, fill: '#FFFFFF' });
          y += 12;
        }
        y += 14;
      }
      return ops;
    }
  },
};
