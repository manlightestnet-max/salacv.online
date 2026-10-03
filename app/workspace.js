// Espace infini (mode Pro) : tous les CV et leurs versions de langue posés côte à côte
// dans un même plan, comme des cadres dans Figma. On glisse le fond pour se déplacer, on
// zoome à la molette (Ctrl) ou au pincement ; un clic sur un cadre le rend actif.
// Le cadre actif reçoit les vraies pages de l'aperçu (édition directe comprise).
import { h } from './dom.js';
import { drawDoc } from './lib/engine.js';

const PAGE = { w: 595.28, h: 841.89 };
const GAP = { x: 120, y: 190 };
const CAM_KEY = 'salacv:ws-cam';
const Z = { min: 0.08, max: 3 };

export function createWorkspace({ preview, canvases, engine, onSwitch, onZoom, onTemplate }) {
  const world = h('div', { class: 'ws-world' });
  let frames = []; // { key, label, el, host, x, y, w, h, active }
  let cam = readCam() ?? { x: 80, y: 80, z: 0.35 };
  let on = false;
  // Miniatures gardées d'un rendu à l'autre : changer de CV ne redessine que ce qui a changé
  // (pas de flash, pas de saccade).
  const thumbs = new Map(); // key -> { canvas, doc, width }

  function readCam() {
    try {
      return JSON.parse(sessionStorage.getItem(CAM_KEY) || 'null');
    } catch {
      return null;
    }
  }
  function apply() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    world.style.setProperty('--wsz', cam.z); // libellés et contours gardent leur taille à l'écran
    try {
      sessionStorage.setItem(CAM_KEY, JSON.stringify(cam));
    } catch {}
    onZoom?.(cam.z);
    preview.dispatchEvent(new Event('ws-camera'));
    scheduleSharpen();
  }

  // --- Cadres -------------------------------------------------------------------------
  // rows : [{ id, label, frames: [{ key, label, active, doc, pages }] }]
  // Un conteneur par CV (sa famille de langues), un cadre par langue à l'intérieur.
  function render(rows) {
    frames = [];
    world.replaceChildren();
    const PAD = 56;
    let y = 0;
    for (const row of rows) {
      // En haut à droite du conteneur : le modèle de ce CV (miniature + nom) ; un clic ouvre
      // le choix des modèles juste là.
      const chip = row.template
        ? h('button', { type: 'button', class: 'ws-group-tpl', title: 'Changer de modèle', onClick: (e) => (e.stopPropagation(), onTemplate?.(row.id, chip)) }, h('canvas', { class: 'ws-tpl-thumb' }), h('span', {}, row.template.name), h('span', { 'aria-hidden': 'true' }, '▾'))
        : null;
      if (chip && row.template.doc) requestAnimationFrame(() => drawDoc(engine, chip.firstChild, row.template.doc, 22));
      const box = h('div', { class: `ws-group${row.frames.some((f) => f.active) ? ' active' : ''}` }, h('span', { class: 'ws-group-label' }, row.label), chip);
      world.append(box);
      let x = PAD;
      let rowH = PAGE.h;
      for (const f of row.frames) {
        const host = h('div', { class: 'ws-pages' });
        const el = h('div', { class: `ws-frame${f.active ? ' active' : ''}`, 'data-key': f.key, style: `left:${x}px;top:${y + PAD + 40}px;width:${PAGE.w}px` }, h('span', { class: 'ws-label' }, f.label), host);
        world.append(el);
        const frame = { ...f, el, host, x, y: y + PAD + 40 };
        if (!f.active && f.doc) {
          let t = thumbs.get(f.key);
          if (!t) thumbs.set(f.key, (t = { canvas: h('canvas', { class: 'ws-thumb' }), doc: null, width: 0 }));
          host.append(t.canvas);
          frame.thumb = t;
        }
        frames.push(frame);
        rowH = Math.max(rowH, f.active ? PAGE.h * Math.max(1, f.pages ?? 1) + 24 * ((f.pages ?? 1) - 1) : PAGE.h);
        x += PAGE.w + GAP.x;
      }
      Object.assign(box.style, { left: '0px', top: `${y}px`, width: `${x - GAP.x + PAD}px`, height: `${rowH + PAD * 2 + 40}px` });
      y += rowH + PAD * 2 + 40 + GAP.y;
    }
    sharpen();
  }

  const activeHost = () => frames.find((f) => f.active)?.host ?? null;

  // Miniatures nettes au zoom courant (recalculées quand le zoom se pose).
  let sharpenTimer;
  function scheduleSharpen() {
    clearTimeout(sharpenTimer);
    sharpenTimer = setTimeout(sharpen, 180);
  }
  function sharpen() {
    const width = PAGE.w * Math.min(2, Math.max(0.25, cam.z * (window.devicePixelRatio || 1)));
    for (const f of frames) {
      const t = f.thumb;
      if (!t || !f.doc || (t.doc === f.doc && t.width === width)) continue;
      drawDoc(engine, t.canvas, f.doc, width);
      Object.assign(t, { doc: f.doc, width });
      t.canvas.style.width = `${PAGE.w}px`;
      t.canvas.style.height = `${PAGE.h}px`;
    }
  }

  // --- Caméra ----------------------------------------------------------------------------
  function zoomAt(next, px, py) {
    next = Math.max(Z.min, Math.min(Z.max, next));
    const r = preview.getBoundingClientRect();
    const sx = px - r.left;
    const sy = py - r.top;
    cam.x = sx - ((sx - cam.x) * next) / cam.z;
    cam.y = sy - ((sy - cam.y) * next) / cam.z;
    cam.z = next;
    apply();
  }
  function zoomBy(factor) {
    const r = preview.getBoundingClientRect();
    zoomAt(cam.z * factor, r.left + r.width / 2, r.top + r.height / 2);
  }
  function setZoom(z) {
    zoomBy(z / cam.z);
  }
  // Tout voir (ou un seul cadre : focus).
  function fit(only) {
    const list = only ? [only] : frames;
    if (!list.length) return;
    const minX = Math.min(...list.map((f) => f.x));
    const minY = Math.min(...list.map((f) => f.y)) - 40;
    const maxX = Math.max(...list.map((f) => f.x + PAGE.w));
    const maxY = Math.max(...list.map((f) => f.y + f.el.offsetHeight));
    const r = preview.getBoundingClientRect();
    const pad = 60;
    cam.z = Math.max(Z.min, Math.min(only ? 1.2 : 1, (r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)));
    cam.x = (r.width - (maxX - minX) * cam.z) / 2 - minX * cam.z;
    cam.y = (r.height - (maxY - minY) * cam.z) / 2 - minY * cam.z;
    apply();
  }
  const focusActive = () => fit(frames.find((f) => f.active));

  // --- Gestes ---------------------------------------------------------------------------
  // Glisser le fond (ou n'importe où avec la molette enfoncée / Espace) : se déplacer.
  // Clic sans glisser sur un autre cadre : il devient actif.
  let drag = null;
  let space = false;
  const touches = new Map();
  let pinch = null;

  preview.addEventListener(
    'wheel',
    (e) => {
      if (!on) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) zoomAt(cam.z * Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.006), e.clientX, e.clientY);
      else {
        cam.x -= e.deltaX;
        cam.y -= e.deltaY;
        apply();
      }
    },
    { passive: false, capture: true },
  );

  preview.addEventListener(
    'pointerdown',
    (e) => {
      if (!on || e.target.closest?.('.ws-group-tpl')) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, e);
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z: cam.z };
          drag = null;
          return;
        }
      }
      const onPage = e.target.closest?.('canvas.page');
      // Sur le cadre actif, le clic sert à l'édition ; ailleurs, on peut se déplacer.
      if (onPage && e.button === 0 && !space) return;
      drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, frame: e.target.closest?.('.ws-frame:not(.active)') };
      preview.setPointerCapture?.(e.pointerId);
      preview.classList.add('ws-grabbing');
    },
    true,
  );
  preview.addEventListener('pointermove', (e) => {
    if (!on) return;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, e);
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      zoomAt(pinch.z * (d / pinch.d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      cam.x = drag.cx + dx;
      cam.y = drag.cy + dy;
      apply();
    }
  });
  const end = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!drag) return;
    preview.classList.remove('ws-grabbing');
    if (!drag.moved && drag.frame) onSwitch?.(drag.frame.dataset.key);
    drag = null;
  };
  preview.addEventListener('pointerup', end);
  preview.addEventListener('pointercancel', end);
  window.addEventListener('keydown', (e) => e.code === 'Space' && on && !e.target.closest?.('input, textarea') && ((space = true), preview.classList.add('ws-space')));
  window.addEventListener('keyup', (e) => e.code === 'Space' && ((space = false), preview.classList.remove('ws-space')));

  return {
    get on() {
      return on;
    },
    get zoom() {
      return cam.z;
    },
    enable() {
      on = true;
      preview.classList.add('ws');
      canvases.replaceChildren(world);
      apply();
    },
    disable() {
      on = false;
      preview.classList.remove('ws');
      world.remove();
    },
    render,
    activeHost,
    zoomBy,
    setZoom,
    fit,
    focusActive,
  };
}
