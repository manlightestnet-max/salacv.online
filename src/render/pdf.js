// Renderer PDF vectoriel (pdf-lib) : rejoue la même display list que Skia.
// Le texte reste du vrai texte (sélectionnable, lisible par les ATS).
import {
  PDFDocument,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
} from 'pdf-lib';
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

// Chemin de découpe d'un rectangle arrondi, en coordonnées PDF (y vers le haut).
function clipRoundedRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const k = r * 0.5523; // approximation d'un quart de cercle par une courbe de Bézier
  return [
    moveTo(x + r, y),
    lineTo(x + w - r, y),
    appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    lineTo(x + r, y + h),
    appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
    clip(),
    endPath(),
  ];
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

  const embeddedImages = {};
  async function pdfImage(key) {
    const entry = doc.images?.[key];
    if (!entry) return null;
    embeddedImages[key] ??= await (entry.type === 'png' ? pdf.embedPng(entry.bytes) : pdf.embedJpg(entry.bytes));
    return embeddedImages[key];
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
        case 'image': {
          const img = await pdfImage(op.src);
          if (!img) break;
          const y = H - op.y - op.h;
          page.pushOperators(pushGraphicsState(), ...clipRoundedRect(op.x, y, op.w, op.h, op.r ?? 0));
          page.drawImage(img, { x: op.x, y, width: op.w, height: op.h });
          page.pushOperators(popGraphicsState());
          break;
        }
      }
    }
  }
  return pdf.save();
}
