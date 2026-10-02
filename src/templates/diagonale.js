// Template "diagonale" : formes en diagonale (turquoise et anthracite) en haut, photo
// arrondie dans une colonne grise (profil/contacts, compétences, langues, loisirs),
// nom en grand et sections à pastille de couleur dans la colonne principale.
import { block } from '../layout/engine.js';
import { contactList, mainSections, photo, sideSections, tone } from './shared.js';

export const DEFAULT_ACCENT = '#2BA6B4';
const PAGE = { width: 595.28, height: 841.89 };
const SIDE = { x: 0, w: 188, pad: 22 };
const X = 212;
const W = PAGE.width - X - 30;
const M = { top: 50, bottom: 50, left: X, right: 30, firstTop: 86 };
const DARK = '#1F2328';

function styles(accent, ghost) {
  return tone(
    {
      name: { font: 'sans-600', size: 25, color: '#111111', tracking: -0.3 },
      job: { font: 'sans-400', size: 11, color: '#4B5563' },
      para: { font: 'sans-400', size: 8.6, color: '#374151' },
      head: { font: 'sans-600', size: 11.5, color: accent },
      period: { font: 'sans-400', size: 7.8, color: '#6B7280' },
      title: { font: 'sans-600', size: 9.2, color: '#111111' },
      org: { font: 'sans-500', size: 8.8, color: '#111111' },
      body: { font: 'sans-400', size: 8.4, color: '#374151' },
      sideHead: { font: 'sans-600', size: 10.5, color: '#111111' },
      label: { font: 'sans-600', size: 7.6, color: '#111111' },
      side: { font: 'sans-400', size: 8, color: '#374151' },
      sideMuted: { font: 'sans-400', size: 8, color: '#6B7280' },
      mark: accent,
      dot: '#374151',
    },
    ghost,
    ['head', 'sideHead', 'mark'],
  );
}

// Petite pastille carrée arrondie devant les titres (à la place d'une icône).
const badge = (ops, x, y, color) => ops.push({ t: 'rect', x, y, w: 7, h: 7, r: 2, fill: color });

export const diagonale = {
  id: 'diagonale',
  margin: M,

  build(resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const p = resume.profile;
    const S = styles(accent, false);
    const G = styles(accent, true);
    const st = (f) => (p.ghost.includes(f) ? G : S);
    const blocks = [];

    {
      const ops = [];
      let y = kit.paragraph(ops, p.name, X, 0, W, st('name').name, 30);
      if (p.title) y += kit.paragraph(ops, p.title, X, y, W, st('title').job, 15);
      if (p.summary) {
        y += 10;
        p.summary.split('\n').filter((l) => l.trim()).forEach((line, i) => {
          if (i) y += 5;
          y += kit.paragraph(ops, line.trim(), X, y, W, st('summary').para, 12.5);
        });
      }
      blocks.push(block(ops, y, { gapAfter: 22 }));
    }

    for (const section of mainSections(resume)) {
      const s = section.ghost ? G : S;
      const head = [];
      badge(head, X, 4, accent);
      kit.paragraph(head, section.title, X + 13, 0, W - 13, S.head, 15);
      blocks.push(block(head, 24, { keepWithNext: true }));
      if (section.type === 'text') {
        const ops = [];
        blocks.push(block(ops, kit.paragraph(ops, section.body, X, 0, W, s.para, 12.5), { gapAfter: 20 }));
        continue;
      }
      section.items.forEach((it, i) => {
        const ops = [];
        let y = 0;
        if (it.period) y += kit.paragraph(ops, it.period, X, y, W, s.period, 11);
        y += kit.paragraph(ops, it.title, X, y, W, s.title, 13);
        const place = [it.org, it.location].filter(Boolean).join(', ');
        if (place) y += kit.paragraph(ops, place, X, y, W, s.org, 12.5);
        if (it.bullets.length) y += 3;
        for (const d of it.bullets) {
          ops.push({ t: 'circle', cx: X + 9, cy: y + 6.5, r: 1.3, fill: s.dot });
          y += kit.paragraph(ops, d, X + 16, y, W - 16, s.body, 12);
        }
        blocks.push(block(ops, y, { gapAfter: i === section.items.length - 1 ? 20 : 12 }));
      });
    }
    return blocks;
  },

  decorate(doc, resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const p = resume.profile;
    const S = styles(accent, false);
    const G = styles(accent, true);

    doc.pages.forEach((ops, i) => {
      const decor = [{ t: 'rect', x: SIDE.x, y: 0, w: SIDE.w, h: PAGE.height, fill: '#F3F4F6' }];
      if (i === 0) {
        decor.push({ t: 'poly', points: [[0, 0], [PAGE.width, 0], [PAGE.width, 26], [0, 74]], fill: accent });
        decor.push({ t: 'poly', points: [[0, 0], [250, 0], [0, 58]], fill: DARK });
        decor.push(...sidebar());
      }
      ops.unshift(...decor);
    });

    function sidebar() {
      const ops = [];
      const x = SIDE.pad;
      const w = SIDE.w - SIDE.pad * 2;
      ops.push({ t: 'rect', x: x - 3, y: 33, w: w + 6, h: w + 6, r: 12, fill: '#FFFFFF' });
      photo(ops, kit, resume, { x, y: 36, w, h: w, r: 10, bg: '#DCEFF1', ink: accent, size: 34 });
      let y = 36 + w + 26;

      const head = (title) => {
        badge(ops, x, y + 4, '#111111');
        y += kit.paragraph(ops, title, x + 13, y, w - 13, S.sideHead, 15) + 6;
      };
      const c = p.ghost.includes('contact') ? G : S;
      const contacts = contactList(p);
      if (contacts.length) {
        head('Profil');
        for (const item of contacts) {
          if (item.label) y += kit.paragraph(ops, item.label, x, y, w, c.label, 11);
          y += kit.paragraph(ops, item.value, x, y, w, c.side, 11.5) + 3;
        }
        y += 14;
      }
      for (const section of sideSections(resume)) {
        const s = section.ghost ? G : S;
        head(section.title);
        for (const item of section.items) {
          ops.push({ t: 'circle', cx: x + 3, cy: y + 6, r: 1.5, fill: s.dot });
          const runs =
            typeof item === 'string'
              ? [{ s: item, style: s.side }]
              : [{ s: item.name, style: s.side }, ...(item.level ? [{ s: ` — ${item.level}`, style: s.sideMuted }] : [])];
          y += kit.rich(ops, runs, x + 11, y, w - 11, 12) + 2;
        }
        y += 14;
      }
      return ops;
    }
  },
};
