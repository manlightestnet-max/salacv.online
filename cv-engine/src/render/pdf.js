// Renderer PDF vectoriel (pdf-lib) : rejoue la même display list que Skia.
// Le texte reste du vrai texte (sélectionnable, lisible par les ATS).
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { NO_SHAPING } from '../fonts.js';

function color(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Rectangle arrondi en chemin SVG (coordonnées y vers le bas, comme la display list).
function roundedRectPath({ x, y, w, h, r = 0 }) {
  r = Math.min(r, w / 2, h / 2);
  if (!r) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  return (
    `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} ` +
    `V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} ` +
    `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} ` +
    `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`
  );
}

export async function renderPdf(doc, fonts, meta = {}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (meta.title) pdf.setTitle(meta.title);
  if (meta.author) pdf.setAuthor(meta.author);
  pdf.setCreator('salacv');
  pdf.setProducer('salacv-engine');

  const embedded = {};
  async function font(key) {
    embedded[key] ??= await pdf.embedFont(fonts.bytes[key], { subset: true, features: NO_SHAPING });
    return embedded[key];
  }

  for (const ops of doc.pages) {
    const page = pdf.addPage([doc.width, doc.height]);
    const H = doc.height;
    for (const op of ops) {
      switch (op.t) {
        case 'text':
          page.drawText(op.s, {
            x: op.x,
            y: H - op.y,
            size: op.size,
            font: await font(op.font),
            color: color(op.color),
            opacity: op.opacity ?? 1,
            // display list : rotation positive = sens horaire (y vers le bas) ;
            // PDF : positif = sens antihoraire.
            rotate: op.rotate ? degrees(-op.rotate) : undefined,
          });
          break;
        case 'rect':
          // drawSvgPath place l'origine du chemin en (x, y) PDF avec y vers le bas.
          page.drawSvgPath(roundedRectPath(op), {
            x: 0,
            y: H,
            color: op.fill ? color(op.fill) : undefined,
            borderColor: op.stroke ? color(op.stroke) : undefined,
            borderWidth: op.stroke ? (op.lw ?? 1) : 0,
          });
          break;
        case 'line':
          page.drawLine({
            start: { x: op.x1, y: H - op.y1 },
            end: { x: op.x2, y: H - op.y2 },
            thickness: op.lw ?? 1,
            color: color(op.color),
          });
          break;
        case 'circle':
          page.drawCircle({ x: op.cx, y: H - op.cy, size: op.r, color: color(op.fill) });
          break;
      }
    }
  }
  return pdf.save();
}
