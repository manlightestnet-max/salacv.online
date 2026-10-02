// Point d'entrée : DSL -> display list paginée.
import { parseResume } from './dsl/schema.js';
import { createKit, paginate, PAGE_SIZES } from './layout/engine.js';
import { templates } from './templates/index.js';

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

  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    if (total > 1) {
      const style = { font: 'mono-400', size: 7, color: '#8A8A85' };
      const label = `${i + 1} / ${total}`;
      kit.text(ops, label, size.width - template.margin.right - kit.width(label, style), size.height - 28, style);
    }
    if (options.watermark) addWatermark(ops, kit, size, options.watermark);
  });

  return { ok: true, resume, doc };
}

function addWatermark(ops, kit, size, text) {
  const style = { font: 'sora-600', size: 30, color: '#0066FF', opacity: 0.07 };
  const w = kit.width(text, style);
  for (let row = 0; row < 5; row++) {
    const y = 150 + row * 160;
    const x = (size.width - w * Math.cos(Math.PI / 6)) / 2;
    ops.push({ t: 'text', x, y, s: text, ...style, rotate: -30 });
  }
}
