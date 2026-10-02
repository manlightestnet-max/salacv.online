// Renderer Skia (CanvasKit) : rejoue la display list sur un canvas.
// Même code dans le navigateur (aperçu de l'éditeur) et dans Node (PNG de test).

export function createSkiaRenderer(CK, fonts) {
  const typefaces = {};
  for (const [key, bytes] of Object.entries(fonts.bytes)) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    typefaces[key] = CK.Typeface.MakeTypefaceFromData(buf);
  }

  const fontCache = new Map();
  function font(key, size) {
    const id = `${key}@${size}`;
    let f = fontCache.get(id);
    if (!f) {
      f = new CK.Font(typefaces[key], size);
      // Avances non arrondies : identiques à celles du layout et du PDF.
      f.setHinting(CK.FontHinting.None);
      f.setSubpixel(true);
      f.setLinearMetrics(true);
      f.setEdging(CK.FontEdging.AntiAlias);
      fontCache.set(id, f);
    }
    return f;
  }

  const paint = new CK.Paint();
  paint.setAntiAlias(true);

  function setColor(hex, opacity = 1) {
    const n = parseInt(hex.slice(1), 16);
    paint.setColor(CK.Color((n >> 16) & 255, (n >> 8) & 255, n & 255, opacity));
  }

  // Dessine une page. `scale` = zoom × devicePixelRatio.
  function drawPage(canvas, doc, pageIndex, scale = 1) {
    canvas.save();
    canvas.scale(scale, scale);
    setColor('#FFFFFF');
    paint.setStyle(CK.PaintStyle.Fill);
    canvas.drawRect(CK.XYWHRect(0, 0, doc.width, doc.height), paint);

    for (const op of doc.pages[pageIndex]) {
      switch (op.t) {
        case 'text':
          paint.setStyle(CK.PaintStyle.Fill);
          setColor(op.color, op.opacity);
          if (op.rotate) {
            canvas.save();
            canvas.rotate(op.rotate, op.x, op.y);
          }
          canvas.drawText(op.s, op.x, op.y, paint, font(op.font, op.size));
          if (op.rotate) canvas.restore();
          break;
        case 'rect': {
          const rr = CK.RRectXY(CK.XYWHRect(op.x, op.y, op.w, op.h), op.r ?? 0, op.r ?? 0);
          if (op.fill) {
            paint.setStyle(CK.PaintStyle.Fill);
            setColor(op.fill);
            canvas.drawRRect(rr, paint);
          }
          if (op.stroke) {
            paint.setStyle(CK.PaintStyle.Stroke);
            paint.setStrokeWidth(op.lw ?? 1);
            setColor(op.stroke);
            canvas.drawRRect(rr, paint);
          }
          break;
        }
        case 'line':
          paint.setStyle(CK.PaintStyle.Stroke);
          paint.setStrokeWidth(op.lw ?? 1);
          setColor(op.color);
          canvas.drawLine(op.x1, op.y1, op.x2, op.y2, paint);
          break;
        case 'circle':
          paint.setStyle(CK.PaintStyle.Fill);
          setColor(op.fill);
          canvas.drawCircle(op.cx, op.cy, op.r, paint);
          break;
      }
    }
    canvas.restore();
  }

  return { drawPage };
}
