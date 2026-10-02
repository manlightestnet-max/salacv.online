// Template "epure" : noir et blanc. Photo, nom centré et contacts à gauche, langues en
// pastilles, filet vertical épais ; à droite « À propos » puis sections séparées par
// des filets, période en gris, « Poste - Organisation » en gras, puces.
import { block } from '../layout/engine.js';
import { contactList, levelScore, mainSections, photo, sideSections, tone } from './shared.js';

const PAGE = { width: 595.28, height: 841.89 };
const SIDE = { x: 30, w: 150 };
const RULE_X = 202;
const X = 222;
const W = PAGE.width - X - 32;
const M = { top: 36, bottom: 46, left: X, right: 32 };

function styles(ghost) {
  return tone(
    {
      name: { font: 'sans-600', size: 15, color: '#111111' },
      job: { font: 'sans-400', size: 9.6, color: '#111111' },
      head: { font: 'sans-600', size: 13, color: '#111111' },
      para: { font: 'sans-400', size: 8.8, color: '#374151' },
      period: { font: 'sans-400', size: 8.6, color: '#4B5563' },
      title: { font: 'sans-600', size: 8.8, color: '#111111' },
      body: { font: 'sans-400', size: 8.6, color: '#374151' },
      label: { font: 'sans-600', size: 8.6, color: '#111111' },
      side: { font: 'sans-400', size: 8.6, color: '#374151' },
      dotOn: '#111111',
      dotOff: '#D1D5DB',
      ink: '#111111',
    },
    ghost,
    ['head'],
  );
}

export const epure = {
  id: 'epure',
  margin: M,

  build(resume, kit) {
    const p = resume.profile;
    const S = styles(false);
    const G = styles(true);
    const blocks = [];
    let first = true;

    // Titre de section ; un filet épais le sépare de la section précédente.
    const heading = (title) => {
      const ops = [];
      let y = 0;
      if (!first) {
        ops.push({ t: 'line', x1: X, y1: 0, x2: X + W, y2: 0, color: '#111111', lw: 1.6 });
        y = 14;
      }
      first = false;
      y += kit.paragraph(ops, title, X, y, W, S.head, 17) + 6;
      return block(ops, y, { keepWithNext: true });
    };

    if (p.summary) {
      blocks.push(heading('À propos'));
      const ops = [];
      const s = p.ghost.includes('summary') ? G : S;
      let y = 0;
      p.summary.split('\n').filter((l) => l.trim()).forEach((line, i) => {
        if (i) y += 5;
        y += kit.paragraph(ops, line.trim(), X, y, W, s.para, 13);
      });
      blocks.push(block(ops, y, { gapAfter: 16 }));
    }

    for (const section of mainSections(resume)) {
      const s = section.ghost ? G : S;
      blocks.push(heading(section.title));
      if (section.type === 'text') {
        const ops = [];
        blocks.push(block(ops, kit.paragraph(ops, section.body, X, 0, W, s.para, 13), { gapAfter: 16 }));
        continue;
      }
      section.items.forEach((it, i) => {
        const ops = [];
        let y = 0;
        if (it.period) y += kit.paragraph(ops, it.period, X, y, W, s.period, 13);
        const place = [it.org, it.location].filter(Boolean).join(', ');
        y += kit.paragraph(ops, place ? `${it.title}  -  ${place}` : it.title, X, y, W, s.title, 13);
        if (it.bullets.length) y += 2;
        for (const d of it.bullets) {
          ops.push({ t: 'circle', cx: X + 7, cy: y + 6.5, r: 1.4, fill: s.ink });
          y += kit.paragraph(ops, d, X + 16, y, W - 16, s.body, 13);
        }
        blocks.push(block(ops, y, { gapAfter: i === section.items.length - 1 ? 16 : 10 }));
      });
    }
    return blocks;
  },

  decorate(doc, resume, kit) {
    const p = resume.profile;
    const S = styles(false);
    const G = styles(true);

    doc.pages.forEach((ops, i) => {
      const decor = [{ t: 'line', x1: RULE_X, y1: 0, x2: RULE_X, y2: PAGE.height, color: '#111111', lw: 1.6 }];
      if (i === 0) decor.push(...sidebar());
      ops.unshift(...decor);
    });

    function sidebar() {
      const ops = [];
      const { x, w } = SIDE;
      photo(ops, kit, resume, { x, y: 36, w, h: 168, r: 0, bg: '#E5E7EB', ink: '#6B7280', size: 36 });
      let y = 36 + 168 + 18;
      const center = (text, style, lh) => {
        for (const line of kit.wrap(text, style.font, style.size, w)) {
          kit.text(ops, line, x + (w - kit.width(line, style)) / 2, kit.baseline(y, style, lh), style);
          y += lh;
        }
      };
      center(p.name, (p.ghost.includes('name') ? G : S).name, 19);
      if (p.title) center(p.title, (p.ghost.includes('title') ? G : S).job, 13);
      y += 16;

      const c = p.ghost.includes('contact') ? G : S;
      for (const item of contactList(p)) {
        if (item.label) {
          ops.push({ t: 'circle', cx: x + 3, cy: y + 6, r: 2, fill: c.ink });
          y += kit.paragraph(ops, item.label, x + 11, y, w - 11, c.label, 12.5);
        }
        y += kit.paragraph(ops, item.value, x, y, w, c.side, 12.5) + 6;
      }
      y += 8;

      for (const section of sideSections(resume)) {
        const s = section.ghost ? G : S;
        y += kit.paragraph(ops, section.title, x, y, w, S.head, 17) + 6;
        for (const item of section.items) {
          if (typeof item === 'string') {
            y += kit.paragraph(ops, item, x, y, w, s.side, 13.5);
            continue;
          }
          // Langue : nom à gauche, niveau en 5 pastilles à droite.
          kit.paragraph(ops, item.name, x, y, w - 52, s.side, 13.5);
          const score = levelScore(item.level);
          for (let k = 0; k < 5; k++) ops.push({ t: 'circle', cx: x + w - 44 + k * 9.5, cy: y + 6.8, r: 3.3, fill: k < score ? s.dotOn : s.dotOff });
          y += 13.5;
        }
        y += 16;
      }
      return ops;
    }
  },
};
