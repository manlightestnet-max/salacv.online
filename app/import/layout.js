// Lecture de la mise en page d'un PDF (sans IA, gratuite) : lignes de texte reconstituées depuis pdf.js, détection
// des colonnes, et choix du mode d'import le moins cher qui marche (voir server/cvimport/extract.js).

/** items pdf.js ({ str, transform, width }) → lignes [{ y, items: [{ x, end, str }] }], de haut en bas. */
export function linesOf(items) {
  const parts = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], end: it.transform[4] + (it.width || 0), str: it.str }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const p of parts) {
    const line = lines.at(-1);
    if (line && Math.abs(line.y - p.y) < 3) line.items.push(p);
    else lines.push({ y: p.y, items: [p] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Lignes → texte (un espace entre deux morceaux séparés). */
export function textOf(lines) {
  return lines
    .map((l) => l.items.reduce((s, it, i) => (i && it.x - l.items[i - 1].end > 1 ? `${s} ${it.str}` : s + it.str), '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Mise en page en colonnes ? (de grands blancs au milieu des lignes, ou beaucoup de lignes qui commencent à droite) */
export function isComplex(lines, width) {
  if (lines.length < 4 || !(width > 0)) return false;
  const gap = width * 0.12;
  const split = lines.filter((l) => l.items.some((it, i) => i && it.x - l.items[i - 1].end > gap)).length;
  const right = lines.filter((l) => l.items[0].x > width * 0.35).length / lines.length;
  return split >= 3 || (lines.length > 8 && right > 0.15 && right < 0.85);
}

/**
 * Le moins cher qui marche : texte seul si le PDF a du texte et une colonne ; images basse résolution + texte s'il est
 * en colonnes ; images nettes s'il n'a pas de texte (scan). → { mode, imageSide }
 */
export function chooseMode({ chars, complex }) {
  if (chars < 200) return { mode: 'scan', imageSide: 1600 };
  if (complex) return { mode: 'mixed', imageSide: 1100 };
  return { mode: 'text', imageSide: 0 };
}
