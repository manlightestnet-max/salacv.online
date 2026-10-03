// DSL « canvas » : un modèle de CV décrit par des primitives (rect, line, circle, poly,
// text, photo, contacts) posées sur une page A4 de 595 × 842 points, plus des zones où
// le contenu du CV s'écoule. N'importe quel agent peut le produire à partir d'une image ;
// le moteur relie les variables connues ({{name}}, {{title}}…) au contenu de l'utilisateur.
// Référence : docs/modeles-dsl.md.
import { label } from '../i18n/index.js';
import { block } from '../layout/engine.js';
import { check, contactList, fade, photo } from './shared.js';

const PAGE = { width: 595.28, height: 841.89 };
const FONT = { sans: { 400: 'sans-400', 500: 'sans-500', 600: 'sans-600', 700: 'sans-600' }, mono: { 400: 'mono-400', 500: 'mono-500', 600: 'mono-500', 700: 'mono-500' } };
const font = (family = 'sans', weight = 400) => FONT[family]?.[weight] ?? 'sans-400';

// Couleur : "#RRGGBB" ou "$nom" (palette du modèle).
function colorOf(spec, c, fallback = '#111111') {
  if (!c) return fallback;
  if (c.startsWith('$')) return spec.colors?.[c.slice(1)] ?? fallback;
  return c;
}

// Variables connues : {{name}}, {{title}}, {{email}}, {{phone}}, {{phones}}, {{address}},
// {{link}}, {{summary}}, {{label:clé}} (libellé traduit, ex. {{label:curriculum}}).
function fill(text, resume) {
  const p = resume.profile;
  const vars = {
    name: p.name,
    title: p.title ?? '',
    email: p.email ?? '',
    phone: p.phones[0] ?? '',
    phones: p.phones.join(' / '),
    address: p.address ?? '',
    link: p.links[0]?.label ?? '',
    summary: p.summary ?? '',
  };
  return String(text).replace(/\{\{\s*([a-z]+)(?::([a-zA-Z.]+))?\s*\}\}/g, (_, k, arg) => (k === 'label' ? label(resume.lang, arg.startsWith('label.') ? arg : `label.${arg}`) : (vars[k] ?? '')));
}
// Champ « exemple » (grisé) d'après les variables utilisées.
function isGhost(text, resume) {
  const g = resume.profile.ghost;
  return (/\{\{\s*name/.test(text) && g.includes('name')) || (/\{\{\s*title/.test(text) && g.includes('title')) || (/\{\{\s*(email|phone|address|link)/.test(text) && g.includes('contact')) || (/\{\{\s*summary/.test(text) && g.includes('summary'));
}

function textStyle(spec, el, ghost) {
  const color = colorOf(spec, el.color);
  return { font: font(el.font, el.weight), size: el.size ?? 10, color: ghost ? fade(color) : color, tracking: el.tracking ?? 0 };
}

// Texte à la position (x, y = haut de la boîte), retour à la ligne dans w, alignement.
function drawText(ops, kit, str, el, style) {
  const lh = el.lineHeight ?? style.size * 1.35;
  const w = el.w ?? PAGE.width - el.x - 20;
  let y = el.y;
  for (const line of kit.wrap(str, style.font, style.size, w)) {
    const lw = kit.width(line, style);
    const x = el.align === 'center' ? el.x + (w - lw) / 2 : el.align === 'right' ? el.x + w - lw : el.x;
    kit.text(ops, line, x, kit.baseline(y, style, lh), style);
    y += lh;
  }
  return y - el.y;
}

// Une primitive → ops (pour l'en-tête et le décor).
function primitive(ops, kit, spec, resume, el) {
  const c = (k, f) => colorOf(spec, el[k], f);
  switch (el.type) {
    case 'rect':
      ops.push({ t: 'rect', x: el.x, y: el.y, w: el.w, h: el.h, r: el.r ?? 0, ...(el.fill ? { fill: c('fill') } : {}), ...(el.stroke ? { stroke: c('stroke'), lw: el.lw ?? 1 } : {}) });
      break;
    case 'line':
      ops.push({ t: 'line', x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, color: c('color'), lw: el.lw ?? 1 });
      break;
    case 'circle':
      ops.push({ t: 'circle', cx: el.cx, cy: el.cy, r: el.r, fill: c('fill') });
      break;
    case 'poly':
      ops.push({ t: 'poly', points: el.points, fill: c('fill') });
      break;
    case 'text': {
      let str = fill(el.text, resume);
      if (!str.trim()) break;
      if (el.upper) str = str.toUpperCase();
      drawText(ops, kit, str, el, textStyle(spec, el, isGhost(el.text, resume)));
      break;
    }
    case 'photo': {
      const r = el.shape === 'circle' ? Math.min(el.w, el.h) / 2 : (el.r ?? 0);
      if (!resume.profile.photo && el.hideEmpty) break;
      photo(ops, kit, resume, { x: el.x, y: el.y, w: el.w, h: el.h, r, bg: c('bg', '#E5E7EB'), ink: '#6B7280', size: Math.min(el.w, el.h) / 3.2 });
      break;
    }
    case 'contacts': {
      // Coordonnées les unes sous les autres (avec leur libellé si labels: true).
      const st = textStyle(spec, el, resume.profile.ghost.includes('contact'));
      const lst = el.labelColor ? { ...st, color: colorOf(spec, el.labelColor), font: font(el.font, 600) } : { ...st, font: font(el.font, 600) };
      let y = el.y;
      const lh = el.lineHeight ?? st.size * 1.45;
      for (const it of contactList(resume.profile, resume.lang)) {
        let str = el.labels && it.label ? `${it.label} : ${it.value}` : it.value;
        if (el.upper) str = str.toUpperCase();
        if (el.labels === 'above' && it.label) y += drawText(ops, kit, it.label, { ...el, y }, lst);
        y += drawText(ops, kit, el.labels === 'above' ? it.value : str, { ...el, y, lineHeight: lh }, st) + (el.gap ?? 2);
      }
      break;
    }
    default:
      break;
  }
}

const SIDE_TYPES = new Set(['bullets', 'list']);

export function fromCanvas(spec) {
  const areas = spec.areas;
  const main = areas.find((a) => a.flow !== false) ?? areas[0];
  const side = areas.filter((a) => a !== main);
  const S = spec.section ?? {};
  const margin = { top: spec.page?.top ?? 40, bottom: spec.page?.bottom ?? 46, left: main.x, right: PAGE.width - main.x - main.w };

  // Contenu attendu par une zone : summary, timeline, text, bullets, list (ou rest).
  const wants = (area, kind) => (area.content ?? (area === main ? ['rest'] : ['bullets', 'list'])).includes(kind);
  const sectionsFor = (area, resume, others) =>
    resume.sections.filter((s) => wants(area, s.type) || (wants(area, 'rest') && !others.some((o) => wants(o, s.type))));

  function styles(ghost) {
    const ink = colorOf(spec, S.color ?? '$ink');
    const t = (hex) => (ghost ? fade(hex) : hex);
    return {
      head: { font: font(S.heading?.font, S.heading?.weight ?? 600), size: S.heading?.size ?? 11, color: colorOf(spec, S.heading?.color ?? '$accent'), tracking: S.heading?.tracking ?? 0.4 },
      body: { font: font(S.font, 400), size: S.size ?? 9.2, color: t(ink) },
      strong: { font: font(S.font, 600), size: (S.size ?? 9.2) + 0.3, color: t(ink) },
      period: { font: font(S.period?.font ?? S.font, S.period?.weight ?? 600), size: S.size ?? 9.2, color: t(colorOf(spec, S.period?.color ?? S.color ?? '$ink')) },
      muted: { font: font(S.font, 400), size: S.size ?? 9.2, color: t(colorOf(spec, S.muted ?? '$muted', '#6B7280')) },
      ink: t(ink),
      bulletColor: t(colorOf(spec, S.bulletColor ?? S.color ?? '$ink')),
    };
  }

  // Titre de section dans une zone (x, w) : bandeau, soulignement, cadre, pastille…
  function heading(kit, title, x, w, y0 = 0) {
    const H = S.heading ?? {};
    let st = styles(false).head;
    const t = H.upper === false ? title : title.toUpperCase();
    // Titre trop long pour la zone (colonne étroite) : on réduit la taille, jamais de débord.
    const room = w - (H.band || H.box ? 16 : 0) - (H.marker ? 14 : 0);
    while (kit.width(t, st) > room && st.size > 6.5) st = { ...st, size: st.size - 0.25 };
    const tw = kit.width(t, st);
    const ops = [];
    const h = H.height ?? 20;
    const align = H.align ?? 'left';
    const tx = align === 'center' ? x + (w - tw) / 2 : x + (H.band || H.box ? 8 : 0) + (H.marker ? 14 : 0);
    if (H.band) ops.push({ t: 'rect', x, y: y0, w, h, r: H.radius ?? 0, fill: colorOf(spec, H.band) });
    if (H.box) ops.push({ t: 'rect', x, y: y0, w, h, r: H.radius ?? 6, stroke: colorOf(spec, H.box), lw: 1 });
    if (H.marker === 'diamond') ops.push({ t: 'poly', points: [[x + 9, y0 + h / 2 - 5], [x + 14, y0 + h / 2], [x + 9, y0 + h / 2 + 5], [x + 4, y0 + h / 2]], fill: colorOf(spec, H.markerColor ?? '$ink') });
    if (H.marker === 'dot') ops.push({ t: 'circle', cx: x + 4, cy: y0 + h / 2, r: 3, fill: colorOf(spec, H.markerColor ?? H.color ?? '$accent') });
    if (H.marker === 'bar') ops.push({ t: 'rect', x, y: y0 + 3, w: 4, h: h - 6, fill: colorOf(spec, H.markerColor ?? H.color ?? '$accent') });
    kit.text(ops, t, tx, y0 + h / 2 + st.size * 0.36, st);
    if (H.underline) {
      const full = H.underline === 'full';
      ops.push({ t: 'line', x1: full ? x : tx, y1: y0 + h - 2, x2: full ? x + w : tx + tw, y2: y0 + h - 2, color: colorOf(spec, H.underlineColor ?? H.color ?? '$accent'), lw: H.underlineWidth ?? 0.8 });
    }
    return { ops, h: h + (H.gap ?? 8) };
  }

  function bullet(ops, x, y, s) {
    const b = S.bullet ?? 'dot';
    if (b === 'check') check(ops, x - 3, y + 3, 6.5, s.bulletColor);
    else if (b === 'arrow') ops.push({ t: 'poly', points: [[x - 3, y + 3.5], [x + 3, y + 7], [x - 3, y + 10.5]], fill: s.bulletColor });
    else if (b === 'dash') ops.push({ t: 'line', x1: x - 3, y1: y + 7, x2: x + 2, y2: y + 7, color: s.bulletColor, lw: 1 });
    else if (b === 'square') ops.push({ t: 'rect', x: x - 2, y: y + 5, w: 4, h: 4, fill: s.bulletColor });
    else if (b !== 'none') ops.push({ t: 'circle', cx: x, cy: y + 7, r: 1.5, fill: s.bulletColor });
  }

  // Une section en morceaux (pour la zone principale qui pagine) ou d'un bloc.
  function sectionParts(kit, section, x, w, lh) {
    const s = styles(section.ghost);
    const parts = [];
    if (section.type === 'text') {
      const ops = [];
      parts.push({ ops, h: kit.paragraph(ops, section.body, x, 0, w, s.body, lh) });
    } else if (section.type === 'timeline') {
      for (const it of section.items) {
        const ops = [];
        let y = 0;
        const head = [it.title, [it.org, it.location].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
        if (it.period && (S.period?.position ?? 'inline') === 'inline') {
          const pt = `${it.period} :`;
          const pw = Math.min(w * 0.35, kit.width(pt, s.period) + 6);
          kit.paragraph(ops, pt, x, y, pw, s.period, lh);
          y += kit.paragraph(ops, head, x + pw, y, w - pw, s.strong, lh);
        } else {
          if (it.period) y += kit.paragraph(ops, it.period, x, y, w, s.period, lh);
          y += kit.paragraph(ops, head, x, y, w, s.strong, lh);
        }
        for (const d of it.bullets) {
          bullet(ops, x + 10, y, s);
          y += kit.paragraph(ops, d, x + 20, y, w - 20, s.body, lh);
        }
        parts.push({ ops, h: y, gap: 7 });
      }
    } else {
      const ops = [];
      let y = 0;
      for (const item of section.items) {
        const text = typeof item === 'string' ? item : item.level ? `${item.name} — ${item.level}` : item.name;
        bullet(ops, x + 4, y, s);
        y += kit.paragraph(ops, text, x + ((S.bullet ?? 'dot') === 'none' ? 0 : 13), y, w - 13, s.body, lh);
      }
      parts.push({ ops, h: y });
    }
    return parts;
  }

  return {
    id: spec.id,
    margin,

    build(resume, kit) {
      const lh = (S.size ?? 9.2) * 1.45;
      const blocks = [];
      // Le contenu de la zone principale commence sous l'en-tête (première page).
      const start = Math.max(0, (main.y ?? margin.top) - margin.top);
      if (start) blocks.push(block([], start));
      const add = (title, parts) => {
        const hd = heading(kit, title, main.x, main.w);
        blocks.push(block(hd.ops, hd.h, { keepWithNext: true }));
        parts.forEach((p, i) => blocks.push(block(p.ops, p.h, { gapAfter: i === parts.length - 1 ? (S.spacing ?? 14) : (p.gap ?? 6) })));
      };
      const p = resume.profile;
      if (p.summary && wants(main, 'summary') && !side.some((a) => wants(a, 'summary'))) {
        const s = styles(p.ghost.includes('summary'));
        const ops = [];
        let h = 0;
        p.summary.split('\n').filter((l) => l.trim()).forEach((line, i) => (h += (i ? 4 : 0) + kit.paragraph(ops, line.trim(), main.x, h + (i ? 4 : 0), main.w, s.body, lh)));
        add(label(resume.lang, 'label.profilePro'), [{ ops, h }]);
      }
      for (const section of sectionsFor(main, resume, side)) add(section.title, sectionParts(kit, section, main.x, main.w, lh));
      return blocks;
    },

    // Décor (toutes les pages ou la première), en-tête et zones latérales (première page).
    decorate(doc, resume, kit) {
      const lh = (S.size ?? 9.2) * 1.45;
      doc.pages.forEach((ops, i) => {
        const under = [];
        if (spec.page?.background) under.push({ t: 'rect', x: 0, y: 0, w: PAGE.width, h: PAGE.height, fill: colorOf(spec, spec.page.background) });
        for (const el of spec.decor ?? []) if ((el.page ?? 'first') === 'all' || i === 0) primitive(under, kit, spec, resume, el);
        if (i === 0) {
          for (const el of spec.header ?? []) primitive(under, kit, spec, resume, el);
          for (const area of side) {
            let y = area.y ?? margin.top;
            const p = resume.profile;
            if (p.summary && wants(area, 'summary')) {
              const hd = heading(kit, label(resume.lang, 'label.profilePro'), area.x, area.w, y);
              under.push(...hd.ops);
              y += hd.h;
              for (const line of p.summary.split('\n').filter((l) => l.trim())) y += kit.paragraph(under, line.trim(), area.x, y, area.w, styles(p.ghost.includes('summary')).body, lh) + 4;
              y += S.spacing ?? 14;
            }
            for (const section of sectionsFor(area, resume, [main, ...side.filter((a) => a !== area)])) {
              if (!SIDE_TYPES.has(section.type) && !wants(area, section.type)) continue;
              const hd = heading(kit, section.title, area.x, area.w, y);
              under.push(...hd.ops);
              y += hd.h;
              for (const part of sectionParts(kit, section, area.x, area.w, lh)) {
                for (const op of part.ops) under.push(shift(op, y));
                y += part.h + (part.gap ?? 4);
              }
              y += S.spacing ?? 14;
            }
          }
        }
        ops.unshift(...under);
      });
    },
  };
}

// Décale une op verticalement (contenu calculé à y = 0, posé dans une zone latérale).
function shift(op, dy) {
  const o = { ...op };
  if ('y' in o) o.y += dy;
  if ('y1' in o) (o.y1 += dy), (o.y2 += dy);
  if ('cy' in o) o.cy += dy;
  if (o.points) o.points = o.points.map(([x, y]) => [x, y + dy]);
  return o;
}
