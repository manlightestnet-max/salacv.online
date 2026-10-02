// Template "contraste" : nom en grandes capitales sur deux lignes, photo en haut à
// droite, bandeau de contact noir ; à gauche profil et expérience, à droite une colonne
// grise avec formation, langues, compétences et loisirs.
import { block } from '../layout/engine.js';
import { photo, splitName, tone } from './shared.js';

const PAGE = { width: 595.28, height: 841.89 };
const X = 40;
const W = 330;
const COL = { x: 396, w: 170, pad: 16, top: 176 };
const BAR = { y: 186 };
const M = { top: 46, bottom: 46, left: X, right: PAGE.width - X - W, firstTop: BAR.y + 76 };

function styles(ghost) {
  return tone(
    {
      name: { font: 'sans-600', size: 31, color: '#111111', tracking: 0.6 },
      job: { font: 'sans-400', size: 9, color: '#4B5563', tracking: 1.6 },
      head: { font: 'sans-600', size: 10.5, color: '#111111', tracking: 1.4 },
      para: { font: 'sans-400', size: 8.4, color: '#4B5563' },
      title: { font: 'sans-600', size: 8.8, color: '#111111' },
      org: { font: 'sans-400', size: 8.4, color: '#111111' },
      period: { font: 'sans-400', size: 8, color: '#6B7280' },
      body: { font: 'sans-400', size: 8.3, color: '#4B5563' },
      side: { font: 'sans-400', size: 8.3, color: '#374151' },
      sideMuted: { font: 'sans-400', size: 8, color: '#6B7280' },
      ink: '#111111',
    },
    ghost,
    ['head'],
  );
}

export const contraste = {
  id: 'contraste',
  margin: M,

  // Colonne gauche : profil puis expériences.
  build(resume, kit) {
    const p = resume.profile;
    const S = styles(false);
    const G = styles(true);
    const blocks = [];
    const heading = (title) => {
      const ops = [];
      return block(ops, kit.paragraph(ops, title.toUpperCase(), X, 0, W, S.head, 15) + 8, { keepWithNext: true });
    };
    const paragraphs = (body, s) => {
      const ops = [];
      let y = 0;
      body.split('\n').filter((l) => l.trim()).forEach((line, i) => {
        if (i) y += 5;
        y += kit.paragraph(ops, line.trim(), X, y, W, s.para, 12.5);
      });
      return block(ops, y, { gapAfter: 22 });
    };

    if (p.summary) blocks.push(heading('Profil'), paragraphs(p.summary, p.ghost.includes('summary') ? G : S));
    for (const section of resume.sections) {
      const s = section.ghost ? G : S;
      if (section.type === 'text') blocks.push(heading(section.title), paragraphs(section.body, s));
      if (section.type !== 'timeline' || section.title.toLowerCase().startsWith('formation')) continue;
      blocks.push(heading(section.title));
      section.items.forEach((it, i) => {
        const ops = [];
        let y = kit.paragraph(ops, it.title, X, 0, W, s.title, 13);
        const place = [it.org, it.location].filter(Boolean).join(' / ');
        if (place) y += kit.paragraph(ops, place, X, y, W, s.org, 12);
        if (it.period) y += kit.paragraph(ops, it.period, X, y, W, s.period, 12);
        if (it.bullets.length) y += 3;
        for (const d of it.bullets) {
          ops.push({ t: 'rect', x: X + 2, y: y + 4.5, w: 3, h: 3, fill: s.ink });
          y += kit.paragraph(ops, d, X + 11, y, W - 11, s.body, 12);
        }
        blocks.push(block(ops, y, { gapAfter: i === section.items.length - 1 ? 22 : 12 }));
      });
    }
    return blocks;
  },

  decorate(doc, resume, kit) {
    const p = resume.profile;
    const S = styles(false);
    const G = styles(true);
    doc.pages.forEach((ops, i) => {
      if (i === 0) ops.unshift(...firstPage());
    });

    function firstPage() {
      const ops = [];
      // Colonne grise, puis photo par-dessus en haut à droite.
      ops.push({ t: 'rect', x: COL.x, y: COL.top, w: COL.w, h: PAGE.height - COL.top - 30, fill: '#EDEDED' });
      photo(ops, kit, resume, { x: COL.x, y: 34, w: COL.w, h: 150, r: 0, bg: '#E5E7EB', ink: '#6B7280', size: 36 });

      // Nom, profession, filet.
      let y = 52;
      for (const line of splitName(p.name)) y += kit.paragraph(ops, line.toUpperCase(), X, y, COL.x - X - 20, (p.ghost.includes('name') ? G : S).name, 34);
      if (p.title) y += 6 + kit.paragraph(ops, p.title.toUpperCase(), X, y + 6, COL.x - X - 20, (p.ghost.includes('title') ? G : S).job, 13);
      ops.push({ t: 'line', x1: X, y1: y + 14, x2: COL.x - 14, y2: y + 14, color: '#9CA3AF', lw: 0.6 });

      // Bandeau de contact noir : téléphone, email, adresse.
      const ghostContact = p.ghost.includes('contact');
      const vs = { font: 'sans-400', size: 7.4, color: '#FFFFFF', opacity: ghostContact ? 0.55 : 0.88 };
      const cells = [
        ['Téléphone', p.phones[0]],
        ['Email', p.email],
        ['Adresse', p.address],
      ].filter(([, v]) => v);
      const cw = (COL.x - X - 22) / Math.max(cells.length, 1);
      // Hauteur du bandeau : la valeur la plus longue (une adresse sur 3 lignes) tient dedans.
      const lines = Math.max(1, ...cells.map(([, v]) => kit.wrap(v, vs.font, vs.size, cw - 8).length));
      ops.push({ t: 'rect', x: X - 8, y: BAR.y, w: COL.x - X - 6, h: 32 + lines * 9.5, fill: '#111111' });
      cells.forEach(([label, value], k) => {
        const cx = X + k * cw;
        kit.text(ops, label, cx, BAR.y + 17, { font: 'sans-600', size: 8, color: '#FFFFFF' });
        kit.paragraph(ops, value, cx, BAR.y + 21, cw - 8, vs, 9.5);
      });

      // Colonne grise : formation, langues, compétences, loisirs.
      const x = COL.x + COL.pad;
      const w = COL.w - COL.pad * 2;
      let sy = COL.top + 32;
      const head = (title) => {
        sy += kit.paragraph(ops, title.toUpperCase(), x, sy, w, S.head, 14) + 8;
      };
      for (const section of resume.sections) {
        const s = section.ghost ? G : S;
        if (section.type === 'timeline' && section.title.toLowerCase().startsWith('formation')) {
          head(section.title);
          for (const it of section.items) {
            if (it.period) sy += kit.paragraph(ops, it.period, x, sy, w, s.period, 11);
            sy += kit.paragraph(ops, it.title, x, sy, w, s.title, 12);
            if (it.org) sy += kit.paragraph(ops, it.org, x, sy, w, s.sideMuted, 11);
            sy += 8;
          }
          sy += 10;
        } else if (section.type === 'bullets' || section.type === 'list') {
          head(section.title);
          for (const item of section.items) {
            ops.push({ t: 'rect', x, y: sy + 4.5, w: 3, h: 3, fill: s.ink });
            const runs =
              typeof item === 'string'
                ? [{ s: item, style: s.side }]
                : [{ s: item.name, style: s.side }, ...(item.level ? [{ s: ` — ${item.level}`, style: s.sideMuted }] : [])];
            sy += kit.rich(ops, runs, x + 10, sy, w - 10, 12) + 2;
          }
          sy += 16;
        }
      }
      return ops;
    }
  },
};
