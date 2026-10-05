// Espace infini (mode Pro) : tous les CV et leurs versions de langue posés côte à côte
// dans un même plan, comme des cadres dans Figma. On glisse le fond pour se déplacer, on
// zoome à la molette (Ctrl) ou au pincement ; un clic sur un cadre le rend actif.
// Le cadre actif reçoit les vraies pages de l'aperçu (édition directe comprise).
import { h, icon } from './dom.js';
import { drawDoc } from './lib/engine.js';

const PAGE = { w: 595.28, h: 841.89 };
const GAP = { x: 120, y: 190 };
const Z = { min: 0.08, max: 3 };

export function createWorkspace({ preview, canvases, engine, onSwitch, onLang, onZoom, onTemplate, onPickTemplate, onExpandTemplates, cardEl }) {
  const world = h('div', { class: 'ws-world' });
  let frames = []; // { key, label, el, host, x, y, w, h, active }
  let cam = { x: 80, y: 80, z: 0.35 };
  let on = false;
  let needFit = false; // à l'ouverture : cadrer le CV actif (et ne pas reprendre un ancien zoom)
  // Miniatures gardées d'un rendu à l'autre : changer de CV ne redessine que ce qui a changé
  // (pas de flash, pas de saccade).
  const thumbs = new Map(); // key -> { canvas, doc, width }

  function apply() {
    // will-change fige la résolution du calque : le CV zoomé devient flou. On ne le garde que
    // pendant le geste, puis on le retire (voir sharpen) pour que le navigateur redessine net.
    world.style.willChange = 'transform';
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    world.style.setProperty('--wsz', cam.z); // libellés et contours gardent leur taille à l'écran
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
      const box = h('div', { class: `ws-group${row.frames.some((f) => f.active) ? ' active' : ''}` }, chip);
      const head = h('div', { class: 'ws-group-head' }, h('span', { class: 'ws-group-label' }, row.label));
      // Versions de langue de ce CV, accrochées à son conteneur : ↻ (retraduire par l'IA), bascule, +.
      if (row.langs) {
        const r = row.refresh;
        head.append(
          h(
            'div',
            { class: 'ws-langs', role: 'toolbar', 'aria-label': 'Langues de ce CV' },
            h('button', { type: 'button', class: `ws-lang-refresh${r.stale ? ' stale' : ''}${r.busy ? ' busy' : ''}`, disabled: !r.lang || r.busy, title: r.title, 'aria-label': r.title, onClick: () => onLang?.(row.id, 'refresh', r.lang) }, icon('refresh', 16)),
            h(
              'div',
              { class: 'ws-lang-toggle', role: 'tablist' },
              row.langs.map((l) => h('button', { type: 'button', role: 'tab', class: `ws-lang-tab${l.active ? ' on' : ''}${l.busy ? ' busy' : ''}`, 'aria-selected': String(l.active), title: l.name, onClick: () => onLang?.(row.id, 'open', l.lang) }, l.lang.toUpperCase())),
            ),
            h('button', { type: 'button', class: 'ws-lang-add', title: 'Ajouter une langue', 'aria-label': 'Ajouter une langue', onClick: () => onLang?.(row.id, 'add') }, icon('plus', 16)),
          ),
        );
      }
      box.append(head);
      world.append(box);
      let x = PAD;
      let rowH = PAGE.h;
      for (const f of row.frames) {
        const host = h('div', { class: 'ws-pages' });
        const el = h('div', { class: `ws-frame${f.active ? ' active' : ''}`, 'data-key': f.key, style: `left:${x}px;top:${y + PAD + 40}px;width:${PAGE.w}px` }, h('span', { class: 'ws-label' }, f.label), host);
        world.append(el);
        const frame = { ...f, el, host, x, y: y + PAD + 40, groupY: y };
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

      // Choix du modèle : la carte des modèles, accrochée à droite de son conteneur (elle
      // suit le conteneur quand on déplace ou zoome l'espace, garde sa taille à l'écran et
      // ne le recouvre jamais).
      if (row.picker) {
        const card = cardEl(row.picker, (tpl) => onPickTemplate?.(row.id, tpl), () => onExpandTemplates?.(row.id));
        Object.assign(card.style, { left: `${x - GAP.x + PAD}px`, top: `${y - (rowH + PAD * 2 + 40 + GAP.y)}px` });
        world.append(card);
      }
    }
    sharpen();
    if (needFit && frames.length) {
      needFit = false;
      focusActive(true);
    }
  }

  // Caméra qui glisse vers une cible (au lieu de sauter) : on voit où l'on va.
  let glideId = 0;
  function glide(to, ms = 320) {
    const id = ++glideId;
    if (!ms) {
      Object.assign(cam, to);
      return apply();
    }
    const from = { ...cam };
    const t0 = performance.now();
    const step = (now) => {
      if (id !== glideId) return; // un autre geste a pris la main
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      cam.z = from.z + (to.z - from.z) * e;
      apply();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const activeHost = () => frames.find((f) => f.active)?.host ?? null;

  // Miniatures nettes au zoom courant (recalculées quand le zoom se pose).
  let sharpenTimer;
  function scheduleSharpen() {
    clearTimeout(sharpenTimer);
    sharpenTimer = setTimeout(sharpen, 180);
  }
  function sharpen() {
    world.style.willChange = 'auto';
    const k = Math.min(2, Math.max(0.25, cam.z * (window.devicePixelRatio || 1)));
    for (const f of frames) {
      const t = f.thumb;
      const fw = f.w ?? PAGE.w;
      const width = fw * k;
      if (!t || !f.doc || (t.doc === f.doc && t.width === width)) continue;
      drawDoc(engine, t.canvas, f.doc, width);
      Object.assign(t, { doc: f.doc, width });
      t.canvas.style.width = `${fw}px`;
      t.canvas.style.height = `${f.h ?? PAGE.h}px`;
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
  // Tout voir (ou un seul cadre : focus). Les éléments flottants (liste du projet et langues en haut,
  // rail à gauche, outils à droite, zoom en bas) gardent leur place : le CV est cadré dans le reste.
  const INSET = { l: 110, r: 90, t: 120, b: 90 };
  function fit(only, instant = false) {
    const list = only ? [only] : frames;
    if (!list.length) return;
    const minX = Math.min(...list.map((f) => f.x));
    const minY = Math.min(...list.map((f) => f.groupY ?? f.y - 44)) - 56; // haut du conteneur + son en-tête
    const maxX = Math.max(...list.map((f) => f.x + PAGE.w));
    const maxY = Math.max(...list.map((f) => f.y + Math.max(f.el.offsetHeight, PAGE.h)));
    const r = preview.getBoundingClientRect();
    const availW = r.width - INSET.l - INSET.r;
    const availH = r.height - INSET.t - INSET.b;
    const z = Math.max(Z.min, Math.min(only ? 1.2 : 1, availW / (maxX - minX), availH / (maxY - minY)));
    glide(
      {
        z,
        x: INSET.l + (availW - (maxX - minX) * z) / 2 - minX * z,
        y: INSET.t + (availH - (maxY - minY) * z) / 2 - minY * z,
      },
      instant ? 0 : 320,
    );
  }
  const focusActive = (instant = false) => fit(frames.find((f) => f.active), instant);
  // Déplace la caméra juste assez pour que la carte des modèles soit entière à l'écran.
  function focusPicker() {
    const card = world.querySelector('.ws-tpl-card');
    if (!card) return;
    const r = preview.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const pad = 24;
    let dx = 0;
    let dy = 0;
    if (c.right > r.right - pad) dx = r.right - pad - c.right;
    if (c.left + dx < r.left + pad) dx = r.left + pad - c.left;
    if (c.top < r.top + 70) dy = r.top + 70 - c.top;
    else if (c.bottom > r.bottom - 80) dy = Math.max(r.top + 70 - c.top, r.bottom - 80 - c.bottom);
    if (!dx && !dy) return;
    cam.x += dx;
    cam.y += dy;
    apply();
  }

  // --- Gestes ---------------------------------------------------------------------------
  // Glisser le fond (ou n'importe où avec la molette enfoncée / Espace) : se déplacer.
  // Clic sans glisser sur un autre cadre : il devient actif.
  let drag = null;
  let space = false;
  // Outils de navigation (aucune manipulation directe des éléments) :
  //   select (V) : cliquer un cadre l'active, glisser le fond déplace la vue (comportement de base)
  //   hand   (H) : glisser n'importe où déplace la vue, même sur le CV actif
  //   zoom   (Z) : clic = zoom avant, Alt + clic = zoom arrière
  //   focus  (F) : cadre le CV actif, puis retour à « select »   ·   Échap : retour à « select »
  let tool = 'select';
  const toolsEl = h('div', { class: 'ws-tools', role: 'toolbar', 'aria-label': 'Outils de navigation' });
  const TOOLS = [
    { id: 'select', key: 'V', label: 'Sélection', icon: '<path d="M5 3l14 7-6 2-2 6z" fill="currentColor"/>' },
    { id: 'hand', key: 'H', label: 'Main (déplacer la vue)', icon: '<path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V13m0-3a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1.5a6 6 0 01-4.7-2.3L4 15a1.5 1.5 0 012.3-1.9L8 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' },
    { id: 'zoom', key: 'Z', label: 'Zoom (Alt : dézoomer)', icon: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
    { id: 'focus', key: 'F', label: 'Cadrer le CV actif', icon: '<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  ];
  function svgIcon(path) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '18');
    s.setAttribute('height', '18');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = path;
    return s;
  }
  function setTool(next) {
    if (next === 'focus') {
      focusActive();
      next = 'select';
    }
    tool = next;
    preview.dataset.tool = tool;
    toolsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  }
  for (const t of TOOLS) {
    toolsEl.append(h('button', { type: 'button', class: 'ws-tool', 'data-tool': t.id, title: `${t.label} (${t.key})`, 'aria-label': `${t.label}, raccourci ${t.key}`, onClick: () => setTool(t.id) }, svgIcon(t.icon), h('kbd', {}, t.key)));
  }

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
      if (!on || e.target.closest?.('.ws-group-tpl, .ws-tpl-card, .ws-langs')) return;
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
      // Sur le cadre actif, le clic sert à l'édition ; ailleurs (ou avec Main / Zoom), on déplace la vue.
      if (onPage && e.button === 0 && !space && tool === 'select') return;
      if (e.target.closest?.('.ws-tools')) return;
      drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, frame: e.target.closest?.('.ws-frame:not(.active)'), tile: e.target.closest?.('.ws-tpl-tile') };
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
    if (!drag.moved && tool === 'zoom') zoomAt(cam.z * (e.altKey ? 1 / 1.4 : 1.4), e.clientX, e.clientY);
    else if (!drag.moved && drag.tile) onPickTemplate?.(drag.tile.dataset.row, drag.tile.dataset.tpl);
    else if (!drag.moved && drag.frame) onSwitch?.(drag.frame.dataset.key);
    drag = null;
  };
  preview.addEventListener('pointerup', end);
  preview.addEventListener('pointercancel', end);
  // Double-clic sur un cadre : il devient actif, la vue le cadre et l'image est redessinée nette.
  preview.addEventListener('dblclick', (e) => {
    if (!on || tool !== 'select') return;
    const frame = e.target.closest?.('.ws-frame:not(.active)');
    if (!frame) return;
    onSwitch?.(frame.dataset.key);
    thumbs.forEach((t) => (t.width = 0));
    requestAnimationFrame(() => (focusActive(), sharpen()));
  });
  window.addEventListener('keydown', (e) => {
    if (!on || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.dialog-backdrop, .tpl-studio')) return;
    const hit = e.key === 'Escape' ? 'select' : TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase())?.id;
    if (hit) setTool(hit);
  });
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
      needFit = true;
      preview.classList.add('ws');
      canvases.replaceChildren(world);
      document.body.append(toolsEl);
      setTool('select');
      apply();
    },
    disable() {
      on = false;
      toolsEl.remove();
      delete preview.dataset.tool;
      preview.classList.remove('ws');
      world.remove();
    },
    render,
    activeHost,
    zoomBy,
    setZoom,
    fit,
    focusActive,
    focusPicker,
  };
}
