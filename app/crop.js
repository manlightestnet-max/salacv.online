// Recadrage de la photo : l'étudiant glisse l'image pour la centrer, zoome (pincement,
// molette ou curseur) dans un cadre carré avec un guide rond, puis valide.
// Sortie : carré JPEG de 360 px en data URL.
import { h } from './dom.js';
import { openDialog } from './dialog.js';

const OUT = 360;
const MAX_ZOOM = 4;

// Fichier ou data URL → image décodée (réduite à 1600 px pour rester fluide).
export async function loadImage(source) {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) return bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

// onDone(dataUrl) quand l'étudiant valide.
export function openCropper(image, onDone) {
  const view = Math.min(300, Math.round(window.innerWidth - 64));
  const dpr = window.devicePixelRatio || 1;
  const canvas = h('canvas', { class: 'crop-canvas', width: view * dpr, height: view * dpr, style: `width:${view}px;height:${view}px` });
  const ctx = canvas.getContext('2d');
  const iw = image.width;
  const ih = image.height;
  const cover = Math.max(view / iw, view / ih); // zoom minimal : l'image remplit le cadre
  let zoom = 1;
  let x = (view - iw * cover) / 2;
  let y = (view - ih * cover) / 2;

  const slider = h('input', { type: 'range', min: '1', max: String(MAX_ZOOM), step: '0.01', value: '1', class: 'crop-zoom', 'aria-label': 'Zoom' });

  // Garde l'image collée aux bords : jamais de vide dans le cadre.
  function clamp() {
    const s = cover * zoom;
    x = Math.min(0, Math.max(view - iw * s, x));
    y = Math.min(0, Math.max(view - ih * s, y));
  }

  function setZoom(next, cx = view / 2, cy = view / 2) {
    next = Math.min(MAX_ZOOM, Math.max(1, next));
    // Zoom autour du point (cx, cy) : ce qui est sous le doigt y reste.
    const ratio = next / zoom;
    x = cx - (cx - x) * ratio;
    y = cy - (cy - y) * ratio;
    zoom = next;
    slider.value = String(zoom);
    clamp();
    draw();
  }

  function draw() {
    const s = cover * zoom;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view, view);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, x, y, iw * s, ih * s);
    // Guide rond : la partie visible dans les modèles à photo ronde.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.rect(0, 0, view, view);
    ctx.arc(view / 2, view / 2, view / 2 - 1, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(view / 2, view / 2, view / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Glisser (un doigt / souris) et pincer (deux doigts).
  const pointers = new Map();
  let last = null;
  let pinch = null;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    last = local(e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, zoom };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      setZoom(pinch.zoom * ((Math.hypot(a[0] - b[0], a[1] - b[1]) || 1) / pinch.dist), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      return;
    }
    const p = local(e);
    x += p[0] - last[0];
    y += p[1] - last[1];
    last = p;
    clamp();
    draw();
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    last = pointers.size ? [...pointers.values()][0] : null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [cx, cy] = local(e);
    setZoom(zoom * Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.004), cx, cy);
  }, { passive: false });
  slider.addEventListener('input', () => setZoom(Number(slider.value)));

  function exportJpeg() {
    const out = document.createElement('canvas');
    out.width = out.height = OUT;
    const s = cover * zoom;
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    o.fillStyle = '#fff';
    o.fillRect(0, 0, OUT, OUT);
    o.drawImage(image, -x / s, -y / s, view / s, view / s, 0, 0, OUT, OUT);
    return out.toDataURL('image/jpeg', 0.88);
  }

  const dialog = openDialog({
    title: 'Recadrer ta photo',
    className: 'crop-dialog',
    content: [
      h('p', { class: 'hint crop-hint' }, 'Glisse pour centrer ton visage, pince ou utilise le curseur pour zoomer.'),
      h('div', { class: 'crop-stage' }, canvas),
      h('div', { class: 'crop-zoom-row' }, h('span', { 'aria-hidden': 'true' }, '−'), slider, h('span', { 'aria-hidden': 'true' }, '+')),
    ],
    footer: [
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler'),
      h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => (onDone(exportJpeg()), dialog.close()) }, 'Valider'),
    ],
  });
  clamp();
  draw();
}
