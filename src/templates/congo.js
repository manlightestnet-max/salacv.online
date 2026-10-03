// Modèles « CV congolais » : une seule colonne, l'ordre des CV qu'on voit à Brazzaville et
// Pointe-Noire (état civil, études, expériences, langues). Cinq variantes d'un même moteur,
// d'après de vrais CV :
//   classique : en-tête en gras à gauche, photo à droite, titres sur bandeau gris (❖)
//   cursus    : « CURRICULUM VITAE » encadré, bandeaux beige centrés, état civil en tableau
//   encadre   : titre noir arrondi, titres de section dans des cadres arrondis centrés
//   sobre     : coordonnées et nom centrés, titres soulignés, puces ➢
//   cahier    : feuille de cahier lignée, marge rouge, titres rouges à puce
import { label } from '../i18n/index.js';
import { block } from '../layout/engine.js';
import { check, contactList, photo, tone } from './shared.js';

const PAGE = { width: 595.28, height: 841.89 };
const M = { top: 46, bottom: 50, left: 54, right: 54 };
const X = M.left;
const W = PAGE.width - M.left - M.right;

const VARIANTS = {
  classique: { head: 'bar', top: 'left', ink: '#111111', accent: '#111111', barBg: '#D9D9D9', bullet: 'check' },
  cursus: { head: 'beige', top: 'banner', ink: '#111111', accent: '#111111', barBg: '#E7E2CF', bullet: 'check' },
  encadre: { head: 'box', top: 'pill', ink: '#111111', accent: '#111111', barBg: '#111111', bullet: 'dot' },
  sobre: { head: 'underline', top: 'center', ink: '#111111', accent: '#111111', barBg: '#111111', bullet: 'arrow' },
  cahier: { head: 'red', top: 'notebook', ink: '#1E3A8A', accent: '#C81E1E', barBg: '#C81E1E', bullet: 'dash' },
};

function styles(v, ghost) {
  return tone(
    {
      name: { font: 'sans-600', size: 17, color: v.ink },
      big: { font: 'sans-600', size: 20, color: v.ink },
      line: { font: 'sans-500', size: 9.6, color: v.ink },
      head: { font: 'sans-600', size: 10.5, color: v.head === 'red' ? v.accent : v.ink, tracking: 0.6 },
      para: { font: 'sans-400', size: 9.4, color: v.ink },
      period: { font: 'sans-600', size: 9.4, color: v.ink },
      title: { font: 'sans-600', size: 9.6, color: v.ink },
      org: { font: 'sans-400', size: 9.4, color: v.ink },
      body: { font: 'sans-400', size: 9.2, color: v.ink },
      key: { font: 'sans-400', size: 9.4, color: '#111111' },
      ink: v.ink,
    },
    ghost,
    ['head'],
  );
}

function make(id) {
  const v = VARIANTS[id];
  return {
    id,
    margin: M,

    build(resume, kit) {
      const p = resume.profile;
      const lang = resume.lang;
      const S = styles(v, false);
      const G = styles(v, true);
      const ghost = (f) => (p.ghost.includes(f) ? G : S);
      const blocks = [top()];

      if (p.summary) {
        blocks.push(heading(label(lang, 'label.profilePro')));
        const ops = [];
        let y = 0;
        p.summary
          .split('\n')
          .filter((l) => l.trim())
          .forEach((line, i) => {
            if (i) y += 4;
            y += kit.paragraph(ops, line.trim(), X, y, W, ghost('summary').para, 13.5);
          });
        blocks.push(block(ops, y, { gapAfter: 14 }));
      }

      for (const section of resume.sections) {
        const s = section.ghost ? G : S;
        blocks.push(heading(section.title));
        if (section.type === 'text') {
          const ops = [];
          blocks.push(block(ops, kit.paragraph(ops, section.body, X, 0, W, s.para, 13.5), { gapAfter: 14 }));
          continue;
        }
        if (section.type === 'timeline') {
          section.items.forEach((it, i) => blocks.push(entry(it, s, i === section.items.length - 1)));
          continue;
        }
        // Listes (compétences, loisirs) et langues : une ligne chacune, puce du modèle.
        const ops = [];
        let y = 0;
        for (const item of section.items) {
          const text = typeof item === 'string' ? item : item.level ? `${item.name} : ${item.level}` : item.name;
          bullet(ops, X + 8, y, s);
          y += kit.paragraph(ops, text, X + 20, y, W - 20, s.body, 13.5);
        }
        blocks.push(block(ops, y, { gapAfter: 14 }));
      }
      return blocks;

      // --- En-tête ---------------------------------------------------------------------
      function top() {
        const ops = [];
        const n = ghost('name');
        const c = ghost('contact');
        const contacts = contactList(p, lang);
        const contactLine = (it) => (it.label ? `${it.label} : ${it.value}` : it.value);
        const hasPhoto = Boolean(p.photo) || v.top !== 'center';
        let y = 0;

        if (v.top === 'center') {
          // Coordonnées en petit, centrées, puis le nom en grand.
          for (const it of contacts) y += centered(ops, contactLine(it).toUpperCase(), y, c.body, 12.5);
          y += 14;
          y += centered(ops, p.name.toUpperCase(), y, n.big, 24);
          if (p.title) y += centered(ops, p.title, y, ghost('title').line, 14);
          return block(ops, y + 14);
        }

        if (v.top === 'banner' || v.top === 'pill' || v.top === 'notebook') {
          const t = label(lang, 'label.curriculum').toUpperCase();
          if (v.top === 'banner') {
            const st = { font: 'sans-400', size: 20, color: '#111111' };
            ops.push({ t: 'rect', x: X + 70, y: 0, w: W - 140, h: 40, r: 4, stroke: '#111111', lw: 1 });
            kit.text(ops, t, X + (W - kit.width(t, st)) / 2, 27, st);
            y = 58;
          } else if (v.top === 'pill') {
            const st = { font: 'sans-600', size: 17, color: '#FFFFFF', tracking: 0.8 };
            const tw = kit.width(t, st) + 60;
            ops.push({ t: 'rect', x: X + (W - tw) / 2, y: 0, w: tw, h: 30, r: 15, fill: '#111111' });
            kit.text(ops, t, X + (W - kit.width(t, st)) / 2, 21, st);
            y = 46;
          } else {
            const st = { font: 'sans-600', size: 21, color: v.accent, tracking: 0.6 };
            kit.text(ops, t, X + (W - kit.width(t, st)) / 2, 22, st);
            ops.push({ t: 'line', x1: X + 120, y1: 30, x2: X + W - 120, y2: 30, color: v.accent, lw: 1 });
            y = 48;
          }
          if (v.top === 'banner') {
            ops.push(...headingOps(label(lang, 'label.identity'), y).ops);
            y += 26;
          }
          // État civil : « Nom : … » en tableau, photo à droite.
          const pw = 92;
          const ph = 104;
          const rows = [
            [label(lang, 'label.name'), p.name, n],
            p.title && [label(lang, 'label.profession'), p.title, ghost('title')],
            ...contacts.map((it) => [it.label || '', it.value, c]),
          ].filter(Boolean);
          const keyW = v.top === 'banner' ? 170 : 110;
          const y0 = y;
          if (v.top === 'pill') {
            y += kit.paragraph(ops, p.name.toUpperCase(), X, y, W - pw - 20, n.title, 14);
            if (p.title) y += kit.paragraph(ops, p.title, X, y, W - pw - 20, ghost('title').org, 13.5);
            for (const it of contacts) y += kit.paragraph(ops, contactLine(it), X, y, W - pw - 20, c.org, 13.5);
          } else {
            for (const [k, val, st] of rows) {
              if (k) kit.paragraph(ops, `${k} :`, X, y, keyW, st.key, 14);
              y += kit.paragraph(ops, val, X + keyW, y, W - keyW - pw - 20, st.org, 14);
            }
          }
          if (hasPhoto) photo(ops, kit, resume, { x: X + W - pw, y: y0, w: pw, h: ph, r: 0, bg: '#E5E7EB', ink: '#6B7280', size: 26 });
          return block(ops, Math.max(y, y0 + ph) + 16);
        }

        // classique : bloc en gras à gauche, photo à droite.
        const pw = 96;
        const ph = 112;
        const tw = W - pw - 20;
        y += kit.paragraph(ops, p.name, X, y, tw, n.name, 22) + 6;
        for (const it of contacts) y += kit.paragraph(ops, contactLine(it), X, y, tw, { ...c.title, size: 9.8 }, 14.5);
        if (p.title) y += kit.paragraph(ops, p.title, X, y, tw, ghost('title').title, 14.5);
        photo(ops, kit, resume, { x: X + W - pw, y: 0, w: pw, h: ph, r: 0, bg: '#E5E7EB', ink: '#6B7280', size: 28 });
        return block(ops, Math.max(y, ph) + 18);
      }

      function centered(ops, text, y, st, lh) {
        let h = 0;
        for (const line of kit.wrap(text, st.font, st.size, W)) {
          kit.text(ops, line, X + (W - kit.width(line, st)) / 2, kit.baseline(y + h, st, lh), st);
          h += lh;
        }
        return h;
      }

      // --- Titres de section --------------------------------------------------------------
      function headingOps(title, y0 = 0) {
        const ops = [];
        const t = title.toUpperCase();
        const st = S.head;
        const tw = kit.width(t, st);
        let h = 22;
        if (v.head === 'bar') {
          ops.push({ t: 'rect', x: X, y: y0, w: W, h: 20, fill: v.barBg });
          ops.push({ t: 'poly', points: [[X + 10, y0 + 5], [X + 15, y0 + 10], [X + 10, y0 + 15], [X + 5, y0 + 10]], fill: '#111111' });
          kit.text(ops, t, X + 22, y0 + 14, st);
        } else if (v.head === 'beige') {
          ops.push({ t: 'rect', x: X, y: y0, w: W, h: 18, fill: v.barBg });
          kit.text(ops, t, X + (W - tw) / 2, y0 + 13, { ...st, font: 'sans-400' });
        } else if (v.head === 'box') {
          ops.push({ t: 'rect', x: X, y: y0, w: W, h: 20, r: 6, stroke: '#111111', lw: 1 });
          kit.text(ops, t, X + (W - tw) / 2, y0 + 14, st);
        } else if (v.head === 'underline') {
          kit.text(ops, t, X, y0 + 12, { ...st, font: 'sans-500' });
          ops.push({ t: 'line', x1: X, y1: y0 + 17, x2: X + W, y2: y0 + 17, color: '#111111', lw: 0.8 });
        } else {
          ops.push({ t: 'circle', cx: X + 3, cy: y0 + 8.5, r: 3, fill: v.accent });
          kit.text(ops, t, X + 12, y0 + 12.5, st);
          ops.push({ t: 'line', x1: X + 12, y1: y0 + 15.5, x2: X + 12 + tw, y2: y0 + 15.5, color: v.accent, lw: 0.8 });
          h = 20;
        }
        return { ops, h };
      }
      function heading(title) {
        const { ops, h } = headingOps(title);
        return block(ops, h + 8, { keepWithNext: true });
      }

      // --- Entrées (formation, expérience) -------------------------------------------------
      function entry(it, s, last) {
        const ops = [];
        let y = 0;
        const head = [it.title, [it.org, it.location].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
        if (it.period) {
          const pt = `${it.period} :`;
          const pw = Math.min(110, kit.width(pt, s.period) + 6);
          kit.paragraph(ops, pt, X, y, pw, s.period, 13.5);
          y += kit.paragraph(ops, head, X + pw, y, W - pw, s.title, 13.5);
        } else y += kit.paragraph(ops, head, X, y, W, s.title, 13.5);
        for (const d of it.bullets) {
          bullet(ops, X + 18, y, s);
          y += kit.paragraph(ops, d, X + 30, y, W - 30, s.body, 13);
        }
        return block(ops, y, { gapAfter: last ? 14 : 8 });
      }

      function bullet(ops, x, y, s) {
        if (v.bullet === 'check') check(ops, x - 3, y + 3, 6.5, s.ink);
        else if (v.bullet === 'arrow') ops.push({ t: 'poly', points: [[x - 3, y + 3.5], [x + 3, y + 7], [x - 3, y + 10.5]], fill: s.ink });
        else if (v.bullet === 'dash') ops.push({ t: 'line', x1: x - 3, y1: y + 7, x2: x + 2, y2: y + 7, color: s.ink, lw: 1 });
        else ops.push({ t: 'circle', cx: x, cy: y + 7, r: 1.5, fill: s.ink });
      }
    },

    // Cahier : feuille lignée et marge rouge, sur chaque page.
    decorate(doc) {
      if (v.top !== 'notebook') return;
      doc.pages.forEach((ops) => {
        const lines = [];
        for (let y = 40; y < PAGE.height - 20; y += 13.5) lines.push({ t: 'line', x1: 0, y1: y, x2: PAGE.width, y2: y, color: '#D6E4F5', lw: 0.5 });
        lines.push({ t: 'line', x1: X - 14, y1: 0, x2: X - 14, y2: PAGE.height, color: '#E8A0A0', lw: 0.8 });
        ops.unshift(...lines);
      });
    },
  };
}

export const classique = make('classique');
export const cursus = make('cursus');
export const encadre = make('encadre');
export const sobre = make('sobre');
export const cahier = make('cahier');
