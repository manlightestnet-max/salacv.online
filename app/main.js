// Éditeur étudiant. Mobile : aperçu plein écran + formulaire dans un bottom
// sheet. PC : formulaire dans une barre de gauche redimensionnable. Aperçu
// zoomable partout ; tant que l'étudiant n'a rien saisi, l'exemple s'affiche
// en grisé pour montrer le format.
import { openThemePicker } from './lib/theme.js';
import { layoutResume } from '../src/index.js';
import { loadEngine } from './lib/engine.js';
import { createProject, getProject, listProjects, read, saveProject, write as store } from './lib/store.js';
import { openExport } from './export.js';
import { initQuickEdit } from './quickedit.js';
import { createLangBar } from './langs.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { STEPS } from './steps.js';
import { createAgentPanel } from './agent.js';
import { normalizeState, fromResume, toResume, checklist, hasGhost, TEMPLATES } from './state.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const preview = $('preview');
const canvases = $('canvases');
const sheet = $('sheet');
const stepEl = $('step');
const desktop = window.matchMedia('(min-width: 960px)');

const WATERMARK = 'salacv.online · aperçu';
const SIDEBAR_KEY = 'salacv:sidebar';
const SIDEBAR = { min: 320, default: 440, max: 760 };
const ZOOM = { min: 0.25, max: 4, step: 1.2 };
// Plafond de résolution des canvas : au-delà, le zoom agrandit sans ajouter de pixels.
const MAX_BACKING_SCALE = 4;

const project = openProject();
project.variants ??= {};
let state = project.state;
let activeLang = state.lang; // onglet de langue affiché (voir langs.js)
let stepIndex = 0;
let current = null; // dernier layout valide
let engine = null; // { CK, fonts, skia } une fois chargé
let pages = []; // [{ el, surface }]
let zoom = { fit: true, value: 1 };
let finalView = false; // « Rendu final » : le CV sans le texte d'exemple en gris
const SIDE_HIDDEN_KEY = 'salacv:sidebar-hidden';
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const ctx = {
  get state() {
    return state;
  },
  changed: schedule,
  onAdd: null, // ajout d'un élément dans l'étape courante (Ctrl+Entrée), déclaré par l'étape
  // Depuis la vérification : ouvre l'étape et place le curseur sur le premier champ vide.
  goToStep(id) {
    goTo(STEPS.findIndex((s) => s.id === id));
    const empty = [...stepEl.querySelectorAll('.input')].find((el) => !el.value && !el.closest('[inert]'));
    empty?.focus({ preventScroll: true });
    empty?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  doc: () => current?.doc,
  photoShape,
  download,
  loadExample() {
    // Seul cas où tout le formulaire change : on reconstruit l'étape.
    state = { ...fromResume(example), template: state.template, lang: state.lang };
    renderStep();
    schedule();
  },
};

// Le formulaire est utilisable tout de suite ; l'aperçu arrive quand le moteur est chargé.
setSidebarWidth(Number(read(SIDEBAR_KEY)) || SIDEBAR.default);
setSheet('collapsed');
renderStep();
initEngine();

$('theme').addEventListener('click', () => openThemePicker());
$('assistant').addEventListener('click', () => (agentOpen ? closeAgent() : openAgent()));
$('toggle').addEventListener('click', () => setSheet(sheet.dataset.state === 'expanded' ? 'collapsed' : 'expanded'));
$('prev').addEventListener('click', () => goTo(stepIndex - 1));
$('peek').addEventListener('click', () => setSheet('collapsed'));
$('next').addEventListener('click', () => goTo(stepIndex + 1));
$('generate').addEventListener('click', download);
initHorizontalScroll($('stepper'));
initHorizontalScroll($('templates'));
$('zoom-in').addEventListener('click', () => zoomBy(ZOOM.step));
$('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM.step));
$('zoom-fit').addEventListener('click', zoomFit);
$('zoom-label').addEventListener('click', () => setZoom(1));
$('final-view').addEventListener('click', () => {
  finalView = !finalView;
  $('final-view').setAttribute('aria-pressed', String(finalView));
  update();
});
$('hide-side').addEventListener('click', () => setSideHidden(true));
$('show-side').addEventListener('click', () => setSideHidden(false));
setSideHidden(read(SIDE_HIDDEN_KEY) === '1');
window.addEventListener('resize', repaint);
desktop.addEventListener('change', () => {
  setSheet(sheet.dataset.state);
  repaint();
});
initSheetDrag();
initKeyboard();
initSplitter();
initPreviewGestures();

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'b' && desktop.matches) {
    e.preventDefault();
    setSideHidden(!root.classList.contains('side-hidden'));
  } else if (mod && key === 's') {
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
  try {
    engine = await loadEngine();
    initQuickEdit({
      canvases,
      preview,
      fonts: engine.fonts,
      getDoc: () => current?.doc,
      getState: () => state,
      mockup: example,
      changed: schedule,
      // Le formulaire reflète ce qui vient d'être modifié sur le CV.
      onClose: () => !agentOpen && renderStep(),
      photoShape,
      // L'IA d'une fenêtre d'édition renvoie un CV : on garde photo, modèle et langue.
      replaceState(next) {
        const { photo } = state.profile;
        const { template, lang } = state;
        state = normalizeState(next);
        Object.assign(state, { template, lang });
        state.profile.photo = photo;
        schedule();
      },
      askLogin: () => openAgent(),
    });
  } catch (err) {
    // Sans moteur, pas d'aperçu : on le dit au lieu de laisser le gris de chargement.
    console.error(err);
    canvases.replaceChildren(
      h('div', { class: 'engine-error' }, h('strong', {}, "L'aperçu n'a pas pu se charger."), h('p', {}, 'Vérifie ta connexion puis recharge la page.'), h('code', {}, String(err?.message ?? err))),
    );
    return;
  }
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
  $('agent-view').inert = !open;
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
    setSidebarWidth(e.clientX - 12); // le panneau flotte à 12 px du bord
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

// --- Clavier mobile ------------------------------------------------------------
// Quand le clavier s'ouvre, la sheet se cale au-dessus de lui (visualViewport, iOS
// compris), les bandes « modèles » et « étapes » se cachent pour laisser la place au
// champ, et le champ actif est ramené au centre.

function initKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  let tallest = vv.height;
  const typing = () => {
    const el = document.activeElement;
    return Boolean(el?.matches?.('input, textarea') && el.type !== 'range' && el.type !== 'file');
  };
  function sync() {
    tallest = Math.max(tallest, vv.height);
    const open = !desktop.matches && typing() && vv.height < tallest * 0.8;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', `${open ? kb : 0}px`);
    root.style.setProperty('--vvh', `${vv.height}px`);
    root.classList.toggle('kb-open', open);
  }
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  document.addEventListener('focusin', (e) => {
    sync();
    if (desktop.matches || !e.target.matches?.('input, textarea') || !sheet.contains(e.target)) return;
    // Après l'animation du clavier : le champ au centre de la partie visible.
    setTimeout(() => {
      sync();
      e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 320);
  });
  document.addEventListener('focusout', () => setTimeout(sync, 50));
}

// --- Assistant ---------------------------------------------------------------

let agentOpen = false;
let agentPanel = null;

// Le panneau remplace les étapes dans la barre ; le CV modifié par l'agent remplace
// celui du formulaire (aperçu mis à jour), l'étudiant peut ensuite tout corriger.
function openAgent() {
  agentPanel ??= createAgentPanel({
    // La photo reste dans le navigateur (jamais envoyée à l'agent) ; le modèle choisi aussi.
    getState: () => ({ ...state, template: undefined, profile: { ...state.profile, photo: undefined } }),
    setState: (next) => {
      const { photo } = state.profile;
      const { template } = state;
      const { lang } = state;
      state = normalizeState(next);
      state.profile.photo = photo;
      state.template = template;
      state.lang = lang;
      schedule();
    },
    onClose: closeAgent,
  });
  if (!agentPanel.el.isConnected) $('agent-view').append(agentPanel.el);
  agentOpen = true;
  sheet.classList.add('agent-mode');
  $('stepper').hidden = true;
  $('sheet-body').hidden = true;
  $('agent-view').hidden = false;
  $('assistant').setAttribute('aria-pressed', 'true');
  $('step-title').textContent = 'Assistant';
  $('progress').textContent = 'Il remplit ton CV pour toi';
  setSheet('expanded');
  agentPanel.focus();
}

function closeAgent() {
  agentOpen = false;
  sheet.classList.remove('agent-mode');
  $('stepper').hidden = false;
  $('sheet-body').hidden = false;
  $('agent-view').hidden = true;
  $('assistant').setAttribute('aria-pressed', 'false');
  renderStep(); // le formulaire reflète ce que l'agent a rempli
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
  ctx.onAdd = null;
  stepEl.replaceChildren(h('div', { class: 'fade' }, step.render(ctx)));
  $('step-title').textContent = step.label;
  $('progress').textContent = `Étape ${stepIndex + 1} sur ${STEPS.length}`;
  $('prev').style.visibility = stepIndex === 0 ? 'hidden' : 'visible';
  $('next').style.visibility = stepIndex === STEPS.length - 1 ? 'hidden' : 'visible';
}

// Ctrl+Entrée : ajoute un bloc dans l'étape courante (le composant place le curseur dedans).
function addItem() {
  ctx.onAdd?.();
}

// --- Aperçu ------------------------------------------------------------------

let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(update, 80);
}

function update() {
  saveCurrent();
  if (!engine) return;
  const result = layoutResume(toResume(state, finalView ? {} : { mockup: example }), engine.fonts, { watermark: WATERMARK });
  const note = $('ghost-note');
  if (!result.ok) {
    // Rendu final sans nom : rien à montrer encore, on le dit.
    if (finalView) {
      note.textContent = 'Écris au moins ton nom pour voir le rendu final';
      note.hidden = false;
    }
    return; // on garde le dernier aperçu valide
  }
  current = result;
  // Pendant un message (toast), l'aide attend son tour.
  if (!note.classList.contains('toast')) {
    note.textContent = finalView ? 'Rendu final : seulement ce que tu as rempli' : 'Touche le CV pour modifier · en gris : exemple';
    note.hidden = !finalView && !hasGhost(result.resume);
  }
  paint(result.doc);
  paintThumbs();
}

// --- Choix du modèle ------------------------------------------------------------
// Une carte par modèle, avec une miniature du CV de l'étudiant dans ce modèle.

const THUMB = { w: 42, h: 59 };
const thumbs = TEMPLATES.map((t) => {
  const canvas = h('canvas', { class: 'tpl-thumb', 'aria-hidden': 'true' });
  const card = h(
    'button',
    {
      type: 'button',
      class: 'tpl-card',
      'aria-pressed': String(state.template === t.id),
      onClick: () => {
        state.template = t.id;
        thumbs.forEach((x) => x.card.setAttribute('aria-pressed', String(x.id === t.id)));
        schedule();
        // La vignette photo de l'étape Identité prend la forme du nouveau modèle.
        if (STEPS[stepIndex].id === 'identite' && !agentOpen) renderStep();
      },
    },
    canvas,
    h('span', {}, t.name),
  );
  return { id: t.id, canvas, card, surface: null };
});
$('templates').replaceChildren(...thumbs.map((t) => t.card));

let thumbTimer;
function paintThumbs() {
  clearTimeout(thumbTimer);
  // Après l'aperçu principal, quand la saisie se calme : les miniatures ne ralentissent pas la frappe.
  thumbTimer = setTimeout(() => {
    thumbs.forEach((x) => x.card.setAttribute('aria-pressed', String(x.id === state.template)));
    const dpr = window.devicePixelRatio || 1;
    const base = toResume(state, { mockup: example });
    for (const t of thumbs) {
      const result = layoutResume({ ...base, template: t.id }, engine.fonts);
      if (!result.ok) continue;
      const scale = (THUMB.w / result.doc.width) * dpr;
      if (!t.surface) {
        t.canvas.width = Math.round(THUMB.w * dpr);
        t.canvas.height = Math.round(THUMB.h * dpr);
        t.surface = engine.CK.MakeSWCanvasSurface(t.canvas);
      }
      engine.skia.drawPage(t.surface.getCanvas(), result.doc, 0, scale);
      t.surface.flush();
    }
  }, 250);
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

// --- Panneau (PC) -----------------------------------------------------------------
// Comme dans les grandes applis : le panneau de gauche se masque pour laisser tout
// l'écran au CV, et revient d'un clic (ou Ctrl B).
function setSideHidden(hidden) {
  root.classList.toggle('side-hidden', hidden);
  $('show-side').hidden = !hidden;
  store(SIDE_HIDDEN_KEY, hidden ? '1' : '0');
  if (engine) repaint();
}

// Forme de la photo dans le modèle choisi (rond, carré arrondi, rectangle), lue dans la
// mise en page elle-même : le recadrage montre exactement ce que le modèle affichera.
function photoShape() {
  if (!engine) return null;
  const base = toResume(state, { mockup: example });
  const r = layoutResume({ ...base, profile: { ...base.profile, photo: TINY_PNG } }, engine.fonts);
  const op = r.ok && r.doc.pages[0].find((o) => o.t === 'image');
  if (!op) return null;
  return { aspect: op.w / op.h, round: (op.r ?? 0) >= Math.min(op.w, op.h) / 2 - 0.5, radius: (op.r ?? 0) / op.w };
}

// --- Versions par langue -----------------------------------------------------------

function saveCurrent() {
  if (activeLang === project.state.lang) project.state = state;
  else project.variants[activeLang] = state;
  saveProject(project);
}

const langBar = createLangBar({
  project,
  getState: () => state,
  getLang: () => activeLang,
  switchTo(lang, next) {
    saveCurrent();
    activeLang = lang;
    state = next;
    renderStep();
    schedule();
  },
  save: saveCurrent,
  askLogin: () => openAgent(),
  toast,
});

// Petit message en haut, à la place de l'aide, quelques secondes.
let toastTimer;
function toast(text) {
  const note = $('ghost-note');
  clearTimeout(toastTimer);
  note.textContent = text;
  note.hidden = false;
  note.classList.add('toast');
  toastTimer = setTimeout(() => {
    note.classList.remove('toast');
    update();
  }, 4200);
}

// --- Projet et export -----------------------------------------------------------

// /studio/?p=<id> ouvre un projet ; ?new (et ?name=) en crée un ; sinon le plus récent.
function openProject() {
  const q = new URLSearchParams(location.search);
  let p = q.has('new') ? null : getProject(q.get('p')) ?? (q.get('p') ? null : listProjects()[0]);
  p ??= createProject({ name: (q.get('name') ?? '').trim().slice(0, 80), template: q.get('template') ?? undefined });
  history.replaceState(null, '', `${location.pathname}?p=${p.id}`);
  return p;
}

// Jamais de téléchargement direct : la préparation (progression, crédit) puis le fichier.
// Disponible à tout moment : la vérification conseille, elle ne bloque pas. Seul le nom
// est indispensable (le CV n'existe pas sans).
function download() {
  if (!engine) return;
  if (!state.profile.name.trim()) {
    toast('Écris d’abord ton nom : il est obligatoire sur le CV.');
    ctx.goToStep('identite');
    setSheet('expanded');
    return;
  }
  const missing = checklist(state, current?.doc).filter((c) => c.level !== 'ok');
  openExport({ state, engine, missing, onReview: () => (goTo(STEPS.length - 1), setSheet('expanded')) });
}

// PC : la molette fait défiler les bandes horizontales (étapes, modèles) ; on peut aussi les glisser.
function initHorizontalScroll(el) {
  el.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    drag = { x: e.clientX, left: el.scrollLeft, moved: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) el.scrollLeft = drag.left - dx;
  });
  // Un glisser n'est pas un clic sur une étape.
  el.addEventListener('click', (e) => drag?.moved && (e.stopPropagation(), e.preventDefault()), true);
  window.addEventListener('pointerup', () => setTimeout(() => (drag = null)));
}
