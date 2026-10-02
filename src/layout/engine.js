// Primitives de layout. Le résultat est une "display list" : une liste
// d'opérations simples (text, rect, line, circle) en points, origine en haut
// à gauche. Les renderers Skia et PDF ne font que la rejouer, aucun calcul
// de placement n'a lieu chez eux.
//
// Ops :
//   { t: 'text',   x, y, s, font, size, color, opacity?, rotate? }   y = ligne de base
//   { t: 'rect',   x, y, w, h, r?, fill?, stroke?, lw? }
//   { t: 'line',   x1, y1, x2, y2, color, lw }
//   { t: 'circle', cx, cy, r, fill }
//   { t: 'image',  x, y, w, h, r?, src }   src = clé dans doc.images, r = rayon des coins (w/2 : rond)

export const PAGE_SIZES = { A4: { width: 595.28, height: 841.89 } };

export function createKit(fonts) {
  // Coupe `text` en lignes de largeur <= maxW (coupure aux espaces, mots trop
  // longs coupés au caractère).
  function wrap(text, font, size, maxW, tracking = 0) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (fonts.measure(candidate, font, size, tracking) <= maxW) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        line = word;
        while (fonts.measure(line, font, size, tracking) > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && fonts.measure(line.slice(0, cut), font, size, tracking) > maxW) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line);
    }
    return lines;
  }

  // Ligne de base qui centre les capitales dans une boîte de hauteur lh.
  function baseline(top, style, lh) {
    return top + (lh + fonts.capHeight(style.font, style.size)) / 2;
  }

  // Ajoute un texte d'une ligne. Avec du tracking, chaque caractère devient un
  // op pour que Skia et le PDF appliquent exactement le même espacement.
  function text(ops, s, x, y, style) {
    const { font, size, color, tracking = 0, opacity } = style;
    s = fonts.sanitize(s, font);
    if (!s) return;
    if (!tracking) {
      ops.push({ t: 'text', x, y, s, font, size, color, opacity });
      return;
    }
    let cx = x;
    for (const ch of s) {
      ops.push({ t: 'text', x: cx, y, s: ch, font, size, color, opacity });
      cx += fonts.measure(ch, font, size) + tracking;
    }
  }

  // Paragraphe multi-lignes ; retourne la hauteur occupée.
  function paragraph(ops, s, x, top, maxW, style, lh) {
    const lines = wrap(fonts.sanitize(s, style.font), style.font, style.size, maxW, style.tracking);
    lines.forEach((line, i) => text(ops, line, x, baseline(top + i * lh, style, lh), style));
    return lines.length * lh;
  }

  const width = (s, style) => fonts.measure(fonts.sanitize(s, style.font), style.font, style.size, style.tracking);

  // Paragraphe à plusieurs styles (ex. "2024 — 2025 | Titre — Organisation").
  // runs = [{ s, style }] ; coupure aux espaces, tous styles confondus.
  // Retourne la hauteur occupée.
  function rich(ops, runs, x, top, maxW, lh) {
    const words = [];
    for (const run of runs) {
      const s = fonts.sanitize(run.s, run.style.font);
      for (const part of s.split(/(\s+)/)) if (part) words.push({ s: part, style: run.style, space: /^\s+$/.test(part) });
    }
    const lines = [[]];
    let lineW = 0;
    for (const w of words) {
      const ww = width(w.s, w.style);
      if (w.space) {
        if (lines.at(-1).length) {
          lines.at(-1).push({ ...w, w: ww });
          lineW += ww;
        }
        continue;
      }
      if (lineW + ww > maxW && lines.at(-1).length) {
        while (lines.at(-1).at(-1)?.space) lines.at(-1).pop();
        lines.push([]);
        lineW = 0;
      }
      lines.at(-1).push({ ...w, w: ww });
      lineW += ww;
    }
    const ref = runs[0].style;
    lines.forEach((line, i) => {
      let cx = x;
      const base = baseline(top + i * lh, ref, lh);
      for (const w of line) {
        if (!w.space) text(ops, w.s, cx, base, w.style);
        cx += w.w;
      }
    });
    return lines.length * lh;
  }

  return { wrap, baseline, text, paragraph, width, rich };
}

// Un bloc = des ops en coordonnées locales (y = 0 en haut du bloc) + sa
// hauteur. keepWithNext empêche un titre de rester seul en bas de page.
export function block(ops, height, { keepWithNext = false, gapAfter = 0 } = {}) {
  return { ops, height, keepWithNext, gapAfter };
}

// Place les blocs sur des pages successives. margin.firstTop : haut de la 1re page
// (sous un bandeau d'en-tête, par exemple).
export function paginate(blocks, { width, height, margin }) {
  const pages = [[]];
  const top = margin.top;
  const bottom = height - margin.bottom;
  let y = margin.firstTop ?? top;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Hauteur à garder ensemble : ce bloc + les suivants liés par keepWithNext.
    let needed = b.height;
    for (let j = i; blocks[j]?.keepWithNext && blocks[j + 1]; j++) needed += blocks[j].gapAfter + blocks[j + 1].height;

    if (y > top && y + needed > bottom) {
      pages.push([]);
      y = top;
    }
    const page = pages[pages.length - 1];
    for (const op of b.ops) page.push(translate(op, y));
    y += b.height + b.gapAfter;
  }
  return { width, height, pages };
}

function translate(op, dy) {
  switch (op.t) {
    case 'line':
      return { ...op, y1: op.y1 + dy, y2: op.y2 + dy };
    case 'circle':
      return { ...op, cy: op.cy + dy };
    default:
      return { ...op, y: op.y + dy };
  }
}
