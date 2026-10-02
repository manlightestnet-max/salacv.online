// Template "vitae" : bande latérale turquoise avec « Curriculum Vitae » vertical, nom et
// contacts en haut, photo à droite, profession centrée, titres soulignés turquoise,
// expériences en « période : organisation », poste en losange, détails cochés.
import { label } from '../i18n/index.js';
import { block } from '../layout/engine.js';
import { check, diamond, photo, tone } from './shared.js';

export const DEFAULT_ACCENT = '#139DA3';
const PAGE = { width: 595.28, height: 841.89 };
const X = 104;
const W = PAGE.width - X - 34;
const M = { top: 54, bottom: 50, left: X, right: 34 };

function styles(accent, ghost) {
  return tone(
    {
      name: { font: 'sans-600', size: 14, color: accent },
      line: { font: 'sans-400', size: 10, color: '#1A1A1A' },
      email: { font: 'sans-500', size: 10, color: '#1D4ED8' },
      profession: { font: 'sans-600', size: 12, color: accent, tracking: 0.3 },
      head: { font: 'sans-600', size: 11.5, color: accent, tracking: 0.2 },
      period: { font: 'sans-600', size: 9.6, color: '#111111' },
      org: { font: 'sans-400', size: 9.6, color: '#111111' },
      title: { font: 'sans-500', size: 9.6, color: '#111111' },
      body: { font: 'sans-400', size: 9.2, color: '#222222' },
      muted: { font: 'sans-400', size: 9.2, color: '#6B7280' },
      mark: accent,
      ink: '#111111',
    },
    ghost,
  );
}

export const vitae = {
  id: 'vitae',
  margin: M,

  build(resume, kit) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const p = resume.profile;
    const S = styles(accent, false);
    const G = styles(accent, true);
    const st = (field) => (p.ghost.includes(field) ? G : S);
    const blocks = [];

    // En-tête : nom, contacts (une ligne chacun) et photo à droite.
    {
      const ops = [];
      const textW = W - 112;
      let y = kit.paragraph(ops, p.name, X, 0, textW, st('name').name, 18);
      const c = st('contact');
      if (p.phones.length) y += kit.paragraph(ops, p.phones.join(' / '), X, y, textW, c.line, 15);
      if (p.email) {
        const base = kit.baseline(y, c.email, 15);
        kit.text(ops, p.email, X, base, c.email);
        ops.push({ t: 'line', x1: X, y1: base + 1.8, x2: X + kit.width(p.email, c.email), y2: base + 1.8, color: c.email.color, lw: 0.6 });
        y += 15;
      }
      for (const l of p.links) y += kit.paragraph(ops, l.label, X, y, textW, c.line, 15);
      if (p.address) y += kit.paragraph(ops, p.address, X, y, textW, c.line, 15);
      photo(ops, kit, resume, { x: X + W - 96, y: -4, w: 96, h: 112, r: 2, bg: '#E6F4F5', ink: accent });
      y = Math.max(y, 112) + 18;
      if (p.title) {
        const t = p.title.toUpperCase();
        const ts = st('title').profession;
        const lines = kit.wrap(t, ts.font, ts.size, W, ts.tracking);
        lines.forEach((line, i) => kit.text(ops, line, X + (W - kit.width(line, ts)) / 2, kit.baseline(y + i * 16, ts, 16), ts));
        y += lines.length * 16;
      }
      blocks.push(block(ops, y, { gapAfter: 16 }));
    }

    const heading = (title) => {
      const ops = [];
      const h = kit.paragraph(ops, title.toUpperCase(), X, 0, W, S.head, 16);
      ops.push({ t: 'line', x1: X - 2, y1: h + 3, x2: X + W, y2: h + 3, color: accent, lw: 1.3 });
      return block(ops, h + 12, { keepWithNext: true });
    };

    const paragraphs = (body, s) => {
      const ops = [];
      let y = 0;
      body.split('\n').filter((l) => l.trim()).forEach((line, i) => {
        if (i) y += 6;
        y += kit.paragraph(ops, line.trim(), X, y, W, s.body, 13.5);
      });
      return block(ops, y, { gapAfter: 18 });
    };

    const checked = (ops, text, x, y, s) => {
      check(ops, x, y + 3.5, 7, s.ink);
      return kit.paragraph(ops, text, x + 14, y, W - (x - X) - 14, s.body, 12.5);
    };

    if (p.summary) blocks.push(heading(label(resume.lang, 'label.profilePro')), paragraphs(p.summary, st('summary')));

    for (const section of resume.sections) {
      const s = section.ghost ? G : S;
      if (section.type === 'timeline' && section.items.length) {
        blocks.push(heading(section.title));
        section.items.forEach((it, i) => {
          const ops = [];
          // « Période : organisation », la période en gras soulignée.
          let y = 0;
          if (it.period) {
            const base = kit.baseline(0, s.period, 15);
            kit.text(ops, it.period, X, base, s.period);
            const pw = kit.width(it.period, s.period);
            ops.push({ t: 'line', x1: X, y1: base + 2, x2: X + pw, y2: base + 2, color: s.ink, lw: 0.7 });
            const place = [it.org, it.location].filter(Boolean).join(', ');
            // Espace insécable : une espace en début de ligne serait retirée par la coupure.
            if (place) kit.rich(ops, [{ s: `\u00A0: ${place}`, style: s.org }], X + pw, 0, W - pw, 15);
            y += 15 + 4;
          }
          diamond(ops, X + 34, y + 7, 3, s.mark);
          y += kit.paragraph(ops, it.title, X + 44, y, W - 44, s.title, 13.5) + 2;
          for (const d of it.bullets) y += checked(ops, d, X + 26, y, s);
          blocks.push(block(ops, y, { gapAfter: i === section.items.length - 1 ? 18 : 10 }));
        });
      } else if ((section.type === 'bullets' || section.type === 'list') && section.items.length) {
        // Deux colonnes : compétences et loisirs cochés, langues en losange.
        const ops = [];
        const colW = (W - 10) / 2;
        let y = 0;
        for (let i = 0; i < section.items.length; i += 2) {
          let rowH = 0;
          for (let c = 0; c < 2 && i + c < section.items.length; c++) {
            const item = section.items[i + c];
            const x = X + 10 + c * colW;
            if (typeof item === 'string') {
              check(ops, x, y + 3.5, 7, s.ink);
              rowH = Math.max(rowH, kit.paragraph(ops, item, x + 14, y, colW - 20, s.body, 12.5));
            } else {
              diamond(ops, x + 3, y + 6.5, 3, s.mark);
              const runs = [{ s: item.name, style: s.title }, ...(item.level ? [{ s: ` — ${item.level}`, style: s.muted }] : [])];
              rowH = Math.max(rowH, kit.rich(ops, runs, x + 14, y, colW - 20, 13));
            }
          }
          y += rowH + 1;
        }
        blocks.push(heading(section.title), block(ops, y, { gapAfter: 18 }));
      } else if (section.type === 'text') {
        blocks.push(heading(section.title), paragraphs(section.body, s));
      }
    }
    return blocks;
  },

  // Bande latérale « Curriculum Vitae » sur chaque page, sous le contenu.
  decorate(doc, resume) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    for (const ops of doc.pages) {
      // Dégradé simplifié (deux tons) puis le bord par-dessus.
      const band = { x: 14, y: 14, w: 58, h: PAGE.height - 28, r: 22 };
      const decor = [
        { t: 'rect', ...band, fill: '#E4F4F5' },
        { t: 'rect', ...band, x: 42, w: 30, fill: '#F1F9FA' },
        { t: 'rect', ...band, stroke: '#A9DADD', lw: 0.8 },
      ];
      decor.push({ t: 'text', x: 58, y: PAGE.height - 70, s: label(resume.lang, 'label.curriculum'), font: 'sans-400', size: 34, color: accent, opacity: 0.22, rotate: -90 });
      ops.unshift(...decor);
    }
  },
};
