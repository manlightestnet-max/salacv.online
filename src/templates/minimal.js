// Template "minimal" : thème Salacope (Geist + Geist Mono, gris zinc, accent
// vert émeraude), labels mono en capitales dans une colonne de gauche.
// Contenu au format CV congolais : en-tête (nom, profession, contacts), profil
// professionnel, puis sections dans l'ordre du DSL. Couleurs = tokens clairs de
// Salacope (le CV s'imprime). Le contenu marqué `ghost` (exemple affiché tant
// que l'étudiant n'a rien saisi) est dessiné en grisé.
import { block } from '../layout/engine.js';

const C = {
  text: '#18181B', // gray-900
  soft: '#3F3F46', // gray-700
  muted: '#71717A', // gray-500
  faint: '#A1A1AA', // gray-400
  border: '#E4E4E7', // gray-200
  chipBg: '#FAFAFA', // gray-50
  status: '#10B981', // primary-500, pastille de statut
};

export const DEFAULT_ACCENT = '#047857'; // accent clair Salacope (primary-700)

const M = { top: 50, bottom: 50, left: 48, right: 48 };
const GUTTER = 112; // colonne des labels
const GAP = 18;
const SECTION_GAP = 24;

// Mélange une couleur vers le blanc (contenu d'exemple).
function fade(hex, t = 0.58) {
  const n = parseInt(hex.slice(1), 16);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0'))
    .join('')}`;
}

function makeStyles(accent, ghost) {
  const c = (hex) => (ghost ? fade(hex) : hex);
  return {
    // Titres : letter-spacing -0.011em comme les h1-h4 de Salacope.
    name: { font: 'sans-600', size: 25, color: c(C.text), tracking: -0.011 * 25 },
    title: { font: 'sans-500', size: 11.5, color: c(accent) },
    contact: { font: 'mono-400', size: 7.6, color: c(C.muted) },
    badge: { font: 'mono-400', size: 7, color: C.muted },
    label: { font: 'mono-500', size: 7, color: C.muted, tracking: 0.9 },
    para: { font: 'sans-400', size: 9.2, color: c(C.soft) },
    period: { font: 'mono-500', size: 7.8, color: c(accent) },
    sep: { font: 'sans-400', size: 9.6, color: c(C.faint) },
    itemTitle: { font: 'sans-600', size: 9.6, color: c(C.text) },
    org: { font: 'sans-400', size: 9.6, color: c(C.muted) },
    detail: { font: 'sans-400', size: 8.8, color: c(C.soft) },
    bullet: { font: 'sans-400', size: 9, color: c(C.soft) },
    listName: { font: 'sans-500', size: 9, color: c(C.text) },
    listLevel: { font: 'sans-400', size: 9, color: c(C.muted) },
    dot: c(accent),
  };
}

export const minimal = {
  id: 'minimal',
  margin: M,

  build(resume, kit, page) {
    const accent = resume.theme.accent ?? DEFAULT_ACCENT;
    const fullW = page.width - M.left - M.right;
    const bodyX = M.left + GUTTER + GAP;
    const bodyW = page.width - M.right - bodyX;
    const S = makeStyles(accent, false);
    const G = makeStyles(accent, true);
    const p = resume.profile;
    const ghosted = (field) => p.ghost.includes(field);

    const blocks = [header()];
    if (p.summary) blocks.push(...withLabel('Profil professionnel', [paragraphs(p.summary, ghosted('summary') ? G : S)]));
    for (const section of resume.sections) blocks.push(...sectionBlocks(section, section.ghost ? G : S));
    return blocks;

    function header() {
      const ops = [];
      let y = 0;

      if (p.badge) {
        const tw = kit.width(p.badge, S.badge);
        const h = 16;
        ops.push({ t: 'rect', x: M.left, y, w: tw + 26, h, r: h / 2, fill: C.chipBg, stroke: C.border, lw: 0.75 });
        ops.push({ t: 'circle', cx: M.left + 9.5, cy: y + h / 2, r: 2.1, fill: C.status });
        kit.text(ops, p.badge, M.left + 17, kit.baseline(y, S.badge, h), S.badge);
        y += h + 14;
      }

      y += kit.paragraph(ops, p.name, M.left, y, fullW, (ghosted('name') ? G : S).name, 30);
      if (p.title) y += 2 + kit.paragraph(ops, p.title, M.left, y + 2, fullW, (ghosted('title') ? G : S).title, 16);

      const contacts = [p.email, ...p.phones, p.address, ...p.links.map((l) => l.label)].filter(Boolean);
      const cs = (ghosted('contact') ? G : S).contact;
      if (contacts.length) y += 8 + kit.paragraph(ops, contacts.join('  ·  '), M.left, y + 8, fullW, cs, 12);

      y += 20;
      ops.push({ t: 'line', x1: M.left, y1: y, x2: M.left + fullW, y2: y, color: C.border, lw: 0.75 });
      return block(ops, y, { gapAfter: 22 });
    }

    // Le label de section est un bloc de hauteur 0 lié au premier élément,
    // pour ne jamais rester seul en bas de page.
    function withLabel(title, items, count = 0) {
      if (!items.length) return [];
      const ops = [];
      const text = (count ? `${title} / ${String(count).padStart(2, '0')}` : title).toUpperCase();
      kit.paragraph(ops, text, M.left, 1, GUTTER, S.label, 11);
      items.at(-1).gapAfter = SECTION_GAP;
      return [block(ops, 0, { keepWithNext: true }), ...items];
    }

    function sectionBlocks(section, st) {
      switch (section.type) {
        case 'timeline':
          return withLabel(section.title, section.items.map((i) => timelineItem(i, st)), section.items.length);
        case 'bullets':
          return withLabel(section.title, [twoColumns(section.items.map((s) => [{ s, style: st.bullet }]), st)]);
        case 'list':
          return withLabel(section.title, [
            twoColumns(section.items.map((i) => [{ s: i.name, style: st.listName }, ...(i.level ? [{ s: ` — ${i.level}`, style: st.listLevel }] : [])]), st),
          ]);
        case 'text':
          return withLabel(section.title, [paragraphs(section.body, st)]);
      }
      return [];
    }

    // Un paragraphe par ligne de texte.
    function paragraphs(body, st) {
      const ops = [];
      let y = 0;
      body.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
        y += (i ? 6 : 0) + kit.paragraph(ops, line, bodyX, y + (i ? 6 : 0), bodyW, st.para, 14);
      });
      return block(ops, y);
    }

    // Format officiel : "2024 — 2025 | Titre — Organisation", puis une ligne par détail.
    function timelineItem(item, st) {
      const ops = [];
      const runs = [];
      if (item.period) runs.push({ s: item.period, style: st.period }, { s: '  |  ', style: st.sep });
      runs.push({ s: item.title, style: st.itemTitle });
      const place = [item.org, item.location].filter(Boolean).join(', ');
      if (place) runs.push({ s: ` — ${place}`, style: st.org });

      let y = kit.rich(ops, runs, bodyX, 0, bodyW, 14);
      if (item.bullets.length) y += 3;
      for (const line of item.bullets) y += kit.paragraph(ops, line, bodyX + 10, y, bodyW - 10, st.detail, 13);
      return block(ops, y, { gapAfter: 12 });
    }

    // Liste à puces sur deux colonnes (compétences, langues, loisirs).
    function twoColumns(entries, st) {
      const ops = [];
      const colGap = 16;
      const colW = (bodyW - colGap) / 2;
      const indent = 10;
      const lh = 14;
      let y = 0;
      for (let i = 0; i < entries.length; i += 2) {
        let rowH = 0;
        for (let c = 0; c < 2 && i + c < entries.length; c++) {
          const x = bodyX + c * (colW + colGap);
          ops.push({ t: 'rect', x, y: y + lh / 2 - 1.5, w: 3, h: 3, r: 0.6, fill: st.dot });
          rowH = Math.max(rowH, kit.rich(ops, entries[i + c], x + indent, y, colW - indent, lh));
        }
        y += rowH + 2;
      }
      return block(ops, Math.max(0, y - 2));
    }
  },
};
