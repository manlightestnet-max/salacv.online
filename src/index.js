// Point d'entrée : DSL -> display list paginée.
import { parseResume } from './dsl/schema.js';
import { createKit, paginate, PAGE_SIZES } from './layout/engine.js';
import { templates } from './templates/index.js';
import { DEFAULT_ACCENT } from './templates/minimal.js';

export { parseResume } from './dsl/schema.js';
export { loadFontSet, createFontSet, FONT_FILES } from './fonts.js';

// options.watermark : texte répété en diagonale (aperçu gratuit avant paiement).
export function layoutResume(input, fonts, options = {}) {
  const parsed = parseResume(input);
  if (!parsed.ok) return parsed;
  const resume = parsed.resume;

  const size = PAGE_SIZES.A4;
  const template = templates[resume.template];
  const kit = createKit(fonts);
  const doc = paginate(template.build(resume, kit, size), { ...size, margin: template.margin });
  doc.images = images(resume);
  // Décor dessiné après la pagination (bandeau, colonne latérale…), sous le contenu.
  template.decorate?.(doc, resume, kit);

  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    if (total > 1) {
      const style = { font: 'mono-400', size: 7, color: '#A1A1AA' };
      const label = `${i + 1} / ${total}`;
      kit.text(ops, label, size.width - template.margin.right - kit.width(label, style), size.height - 28, style);
    }
    if (options.watermark) addWatermark(ops, kit, size, options.watermark, resume.theme.accent ?? DEFAULT_ACCENT);
  });

  return { ok: true, resume, doc };
}

// Images référencées par les ops `image` : { clé: { bytes, type } }.
function images(resume) {
  const out = {};
  const m = resume.profile.photo?.match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (m) out.photo = { type: m[1], bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) };
  return out;
}

function addWatermark(ops, kit, size, text, color) {
  const style = { font: 'sans-600', size: 30, color, opacity: 0.07 };
  const w = kit.width(text, style);
  for (let row = 0; row < 5; row++) {
    const y = 150 + row * 160;
    const x = (size.width - w * Math.cos(Math.PI / 6)) / 2;
    ops.push({ t: 'text', x, y, s: text, ...style, rotate: -30 });
  }
}
