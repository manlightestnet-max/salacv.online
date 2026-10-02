// Éditeur étudiant. Mobile : aperçu plein écran + formulaire dans un bottom
// sheet. PC : formulaire dans une barre de gauche redimensionnable. Aperçu
// zoomable partout ; tant que l'étudiant n'a rien saisi, l'exemple s'affiche
// en grisé pour montrer le format.
import CanvasKitInit from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import { layoutResume, loadFontSet } from '../src/index.js';
import { createSkiaRenderer } from '../src/render/skia.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { STEPS } from './steps.js';
import { emptyState, fromResume, toResume, checklist, hasGhost } from './state.js';

const fontUrls = import.meta.glob('../fonts/*.ttf', { query: '?url', import: 'default', eager: true });
const fontUrl = (file) => fontUrls[`../fonts/${file}`];

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const preview = $('preview');
const canvases = $('canvases');
const sheet = $('sheet');
const stepEl = $('step');
const desktop = window.matchMedia('(min-width: 960px)');

const WATERMARK = 'salacv.online · aperçu';
const DRAFT_KEY = 'salacv:form:v2';
const THEME_KEY = 'salacv:theme';
const SIDEBAR_KEY = 'salacv:sidebar';
const SIDEBAR = { min: 320, default: 440, max: 760 };
const ZOOM = { min: 0.25, max: 4, step: 1.2 };
// Plafond de résolution des canvas : au-delà, le zoom agrandit sans ajouter de pixels.
const MAX_BACKING_SCALE = 4;

let state = readDraft() ?? emptyState();
let stepIndex = 0;
let current = null; // dernier layout valide
let engine = null; // { CK, fonts, skia } une fois chargé
let pages = []; // [{ el, surface }]
let zoom = { fit: true, value: 1 };

const ctx = {
  get state() {
    return state;
  },
  changed: schedule,
  rerender() {
    renderStep();
    schedule();
  },
  addItem,
  doc: () => current?.doc,
  download,
  loadExample() {
    state = fromResume(example);
    ctx.rerender();
  },
};

// Le formulaire est utilisable tout de suite ; l'aperçu arrive quand le moteur est chargé.
setSidebarWidth(Number(read(SIDEBAR_KEY)) || SIDEBAR.default);
setSheet('collapsed');
renderStep();
initEngine();

$('theme').addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  store(THEME_KEY, next);
});
$('toggle').addEventListener('click', () => setSheet(sheet.dataset.state === 'expanded' ? 'collapsed' : 'expanded'));
$('prev').addEventListener('click', () => goTo(stepIndex - 1));
$('next').addEventListener('click', () => goTo(stepIndex + 1));
$('zoom-in').addEventListener('click', () => zoomBy(ZOOM.step));
$('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM.step));
$('zoom-fit').addEventListener('click', zoomFit);
$('zoom-label').addEventListener('click', () => setZoom(1));
window.addEventListener('resize', repaint);
desktop.addEventListener('change', () => {
  setSheet(sheet.dataset.state);
  repaint();
});
initSheetDrag();
initSplitter();
initPreviewGestures();

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 's') {
    e.preventDefault();
    goTo(STEPS.length - 1);
    setSheet('expanded');
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    addItem();
  } else if (mod && (key === '+' || key === '=')) {
    e.preventDefault();
    zoomBy(ZOOM.step);
  } else if (mod && key === '-') {
    e.preventDefault();
    zoomBy(1 / ZOOM.step);
  } else if (mod && key === '0') {
    e.preventDefault();
    zoomFit();
  } else if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    goTo(stepIndex + 1);
  } else if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    goTo(stepIndex - 1);
  } else if (e.key === 'Escape' && sheet.dataset.state === 'expanded' && !desktop.matches) {
    setSheet('collapsed');
  }
});

async function initEngine() {
  const [CK, fonts] = await Promise.all([
    CanvasKitInit({ locateFile: () => wasmUrl }),
    loadFontSet((file) => fetch(fontUrl(file)).then((r) => r.arrayBuffer())),
  ]);
  engine = { CK, fonts, skia: createSkiaRenderer(CK, fonts) };
  update();
  if (STEPS[stepIndex].id === 'verification') renderStep();
}

// --- Bottom sheet (mobile) / barre de gauche (PC) ------------------------------

function setSheet(next) {
  sheet.dataset.state = next;
  sheet.style.transform = '';
  const open = desktop.matches || next === 'expanded';
  $('toggle').textContent = next === 'expanded' ? 'Aperçu' : 'Modifier';
  $('sheet-body').inert = !open; // pas de focus clavier dans la partie cachée
  if (!open) document.activeElement?.blur();
}

// Mobile : glisser la poignée ou l'en-tête ; vers le haut ouvre, vers le bas
// ferme, un simple appui bascule.
function initSheetDrag() {
  let start = null;
  for (const zone of [$('grip'), $('sheet-head')]) {
    zone.addEventListener('pointerdown', (e) => {
      if (desktop.matches || e.target.closest('button')) return;
      start = { y: e.clientY, base: sheet.getBoundingClientRect().top, moved: false };
      sheet.classList.add('dragging');
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 4) start.moved = true;
      const min = window.innerHeight - sheet.offsetHeight; // haut de la sheet dépliée
      sheet.style.transform = `translateY(${Math.max(min, start.base + dy) - min}px)`;
    });
    const end = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      sheet.classList.remove('dragging');
      if (!start.moved) setSheet(sheet.dataset.state === 'expanded' ? 'collapsed' : 'expanded');
      else setSheet(dy < -40 ? 'expanded' : dy > 40 ? 'collapsed' : sheet.dataset.state);
      start = null;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}

function setSidebarWidth(w) {
  const max = Math.min(SIDEBAR.max, window.innerWidth * 0.6);
  const width = Math.round(Math.max(SIDEBAR.min, Math.min(max, w)));
  root.style.setProperty('--sidebar-w', `${width}px`);
  $('splitter').setAttribute('aria-valuenow', String(width));
  return width;
}

// PC : la barre de gauche se redimensionne en glissant la séparation
// (double-clic : largeur par défaut, flèches au clavier).
function initSplitter() {
  const splitter = $('splitter');
  let dragging = false;
  splitter.addEventListener('pointerdown', (e) => {
    dragging = true;
    splitter.setPointerCapture(e.pointerId);
    root.classList.add('resizing');
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setSidebarWidth(e.clientX);
    repaint();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('resizing');
    store(SIDEBAR_KEY, String(parseInt(getComputedStyle(root).getPropertyValue('--sidebar-w'), 10)));
  };
  splitter.addEventListener('pointerup', end);
  splitter.addEventListener('pointercancel', end);
  splitter.addEventListener('dblclick', () => {
    store(SIDEBAR_KEY, String(setSidebarWidth(SIDEBAR.default)));
    repaint();
  });
  splitter.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const now = parseInt(getComputedStyle(root).getPropertyValue('--sidebar-w'), 10);
    store(SIDEBAR_KEY, String(setSidebarWidth(now + (e.key === 'ArrowRight' ? 24 : -24))));
    repaint();
  });
}

// --- Étapes ------------------------------------------------------------------

function goTo(i) {
  if (i < 0 || i >= STEPS.length || i === stepIndex) return;
  stepIndex = i;
  renderStep();
  stepEl.scrollTop = 0;
}

function renderStep() {
  const step = STEPS[stepIndex];
  $('stepper').replaceChildren(
    ...STEPS.map((s, i) =>
      h(
        'button',
        {
          type: 'button',
          class: `step-pill${i === stepIndex ? ' active' : ''}${i < stepIndex ? ' done' : ''}`,
          'aria-current': i === stepIndex ? 'step' : null,
          onClick: () => {
            goTo(i);
            setSheet('expanded');
          },
        },
        h('span', { class: 'step-num' }, i < stepIndex ? '✓' : String(i + 1)),
        s.label,
      ),
    ),
  );
  $('stepper').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  stepEl.replaceChildren(h('div', { class: 'fade' }, step.render(ctx)));
  $('step-title').textContent = step.label;
  $('progress').textContent = `Étape ${stepIndex + 1} sur ${STEPS.length}`;
  $('prev').style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
  $('next').style.visibility = stepIndex === STEPS.length - 1 ? 'hidden' : 'visible';
}

// Ajoute un élément à la liste de l'étape courante et place le curseur dedans.
function addItem() {
  const step = STEPS[stepIndex];
  if (!step.add) return;
  step.add(state);
  ctx.rerender();
  const rows = stepEl.querySelectorAll('.card, .row');
  rows[rows.length - 1]?.querySelector('.input')?.focus();
}

// --- Aperçu ------------------------------------------------------------------

let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(update, 80);
}

function update() {
  store(DRAFT_KEY, JSON.stringify(state));
  if (!engine) return;
  const result = layoutResume(toResume(state, { mockup: example }), engine.fonts, { watermark: WATERMARK });
  if (!result.ok) return; // le formulaire limite déjà les saisies ; on garde le dernier aperçu valide
  current = result;
  $('ghost-note').hidden = !hasGhost(result.resume);
  paint(result.doc);
}

let frame = 0;
function repaint() {
  if (!current || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paint(current.doc);
  });
}

function fitZoom(doc) {
  const pad = preview.clientWidth < 640 ? 8 : 32;
  return Math.min(1.4, (preview.clientWidth - pad * 2) / doc.width);
}

function paint(doc) {
  const { CK, skia } = engine;
  const z = zoom.fit ? fitZoom(doc) : zoom.value;
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(z * dpr, MAX_BACKING_SCALE);
  const w = Math.round(doc.width * z);
  const hgt = Math.round(doc.height * z);
  const bw = Math.round(doc.width * scale);
  const bh = Math.round(doc.height * scale);

  while (pages.length > doc.pages.length) {
    const p = pages.pop();
    p.surface?.delete();
    p.el.remove();
  }
  while (pages.length < doc.pages.length) {
    const el = document.createElement('canvas');
    canvases.append(el);
    pages.push({ el, surface: null });
  }
  canvases.querySelector('.page-skeleton')?.remove();

  doc.pages.forEach((_, i) => {
    const p = pages[i];
    p.el.style.width = `${w}px`;
    p.el.style.height = `${hgt}px`;
    // Surface logicielle : pas de limite de contextes WebGL quand on zoome souvent.
    if (!p.surface || p.el.width !== bw || p.el.height !== bh) {
      p.surface?.delete();
      p.el.width = bw;
      p.el.height = bh;
      p.surface = CK.MakeSWCanvasSurface(p.el);
    }
    skia.drawPage(p.surface.getCanvas(), doc, i, scale);
    p.surface.flush();
  });

  $('zoom-label').textContent = `${Math.round(z * 100)} %`;
  $('zoom-fit').classList.toggle('active', zoom.fit);
}

// Zoom en gardant le même point au centre de l'aperçu.
function setZoom(value, fit = false) {
  if (!current) return;
  const cx = (preview.scrollLeft + preview.clientWidth / 2) / preview.scrollWidth;
  const cy = (preview.scrollTop + preview.clientHeight / 2) / preview.scrollHeight;
  zoom = { fit, value: Math.max(ZOOM.min, Math.min(ZOOM.max, value)) };
  paint(current.doc);
  preview.scrollLeft = cx * preview.scrollWidth - preview.clientWidth / 2;
  preview.scrollTop = cy * preview.scrollHeight - preview.clientHeight / 2;
}

function currentZoom() {
  return zoom.fit && current ? fitZoom(current.doc) : zoom.value;
}

function zoomBy(factor) {
  setZoom(currentZoom() * factor);
}

function zoomFit() {
  setZoom(1, true);
}

// Ctrl + molette (et pincement du pavé tactile) sur PC, pincement à deux doigts sur mobile.
function initPreviewGestures() {
  preview.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Un cran de molette (~100) ≈ ×0,82 ; le pincement du pavé tactile envoie de petits pas.
      const delta = Math.max(-50, Math.min(50, e.deltaY));
      setZoom(currentZoom() * Math.exp(-delta * 0.004));
    },
    { passive: false },
  );

  const touches = new Map();
  let pinch = null;
  preview.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, e);
    if (touches.size === 2) pinch = { dist: distance(), zoom: currentZoom() };
  });
  preview.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, e);
    if (pinch && touches.size === 2) setZoom(pinch.zoom * (distance() / pinch.dist));
  });
  const end = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };
  preview.addEventListener('pointerup', end);
  preview.addEventListener('pointercancel', end);

  function distance() {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  }
}

// --- PDF ---------------------------------------------------------------------

// Le PDF est généré sans filigrane ni exemple, depuis les seules saisies.
// TODO : passer par le paiement mobile money avant de débloquer le téléchargement.
async function download() {
  if (!engine || checklist(state, current?.doc).some((c) => c.level === 'todo')) return;
  const result = layoutResume(toResume(state), engine.fonts);
  if (!result.ok) return;
  const { renderPdf } = await import('../src/render/pdf.js');
  const name = result.resume.profile.name;
  const bytes = await renderPdf(result.doc, engine.fonts, { title: `CV — ${name}`, author: name });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  h('a', { href: url, download: `CV-${slug(name)}.pdf` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function readDraft() {
  try {
    const raw = read(DRAFT_KEY);
    return raw ? { ...emptyState(), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // stockage indisponible (navigation privée)
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage indisponible (navigation privée) : on ignore
  }
}
