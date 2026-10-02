// Éditeur étudiant, mobile first : aperçu du CV en plein écran, formulaire
// en 6 étapes dans un bottom sheet (replié / déplié), PDF au téléchargement.
import CanvasKitInit from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import { layoutResume, loadFontSet } from '../src/index.js';
import { createSkiaRenderer } from '../src/render/skia.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { STEPS } from './steps.js';
import { emptyState, fromResume, toResume, checklist } from './state.js';

const fontUrls = import.meta.glob('../fonts/*.ttf', { query: '?url', import: 'default', eager: true });
const fontUrl = (file) => fontUrls[`../fonts/${file}`];

const $ = (id) => document.getElementById(id);
const preview = $('preview');
const canvases = $('canvases');
const sheet = $('sheet');
const stepEl = $('step');

const WATERMARK = 'salacv.online · aperçu';
const DRAFT_KEY = 'salacv:form:v2';
const THEME_KEY = 'salacv:theme';

let state = readDraft() ?? emptyState();
let stepIndex = 0;
let current = null; // dernier layout valide
let engine = null; // { CK, fonts, skia } une fois chargé
let surfaces = [];

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
setSheet('collapsed');
renderStep();
initEngine();

$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store(THEME_KEY, next);
});
$('toggle').addEventListener('click', () => setSheet(sheet.dataset.state === 'expanded' ? 'collapsed' : 'expanded'));
$('prev').addEventListener('click', () => goTo(stepIndex - 1));
$('next').addEventListener('click', () => goTo(stepIndex + 1));
window.addEventListener('resize', () => current && paint(current.doc));
initDrag();

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    goTo(STEPS.length - 1);
    setSheet('expanded');
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    addItem();
  } else if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    goTo(stepIndex + 1);
  } else if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    goTo(stepIndex - 1);
  } else if (e.key === 'Escape' && sheet.dataset.state === 'expanded') {
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

// --- Bottom sheet ------------------------------------------------------------

function setSheet(next) {
  sheet.dataset.state = next;
  sheet.style.transform = '';
  const expanded = next === 'expanded';
  $('toggle').textContent = expanded ? 'Aperçu' : 'Modifier';
  $('sheet-body').inert = !expanded; // pas de focus clavier dans la partie cachée
  if (!expanded) document.activeElement?.blur();
}

// Glisser la poignée ou l'en-tête : vers le haut ouvre, vers le bas ferme ;
// un simple appui bascule.
function initDrag() {
  let start = null;
  const zones = [$('grip'), $('sheet-head')];
  for (const zone of zones) {
    zone.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      start = { y: e.clientY, base: sheet.getBoundingClientRect().top, moved: false };
      sheet.classList.add('dragging');
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 4) start.moved = true;
      const min = window.innerHeight - sheet.offsetHeight; // haut de la sheet dépliée
      const top = Math.max(min, start.base + dy);
      sheet.style.transform = `translateY(${top - min}px)`;
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
  const result = layoutResume(toResume(state, { placeholderName: 'Ton nom' }), engine.fonts, { watermark: WATERMARK });
  if (!result.ok) return; // le formulaire limite déjà les saisies ; on garde le dernier aperçu valide
  current = result;
  paint(result.doc);
}

function paint(doc) {
  const { CK, skia } = engine;
  const pad = preview.clientWidth < 640 ? 8 : 24;
  const zoom = Math.min(1.6, (preview.clientWidth - pad * 2) / doc.width);
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(doc.width * zoom);
  const hgt = Math.round(doc.height * zoom);

  // Recrée les surfaces seulement si le nombre de pages ou la taille change.
  if (surfaces.length !== doc.pages.length || surfaces[0]?.w !== w) {
    surfaces.forEach((s) => s.surface.delete());
    canvases.replaceChildren();
    surfaces = doc.pages.map(() => {
      const el = document.createElement('canvas');
      el.width = Math.round(w * dpr);
      el.height = Math.round(hgt * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${hgt}px`;
      canvases.append(el);
      return { surface: CK.MakeCanvasSurface(el), w };
    });
  }

  doc.pages.forEach((_, i) => {
    const { surface } = surfaces[i];
    skia.drawPage(surface.getCanvas(), doc, i, zoom * dpr);
    surface.flush();
  });
}

// --- PDF ---------------------------------------------------------------------

// Le PDF est généré sans filigrane depuis les mêmes données que l'aperçu.
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
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...emptyState(), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage indisponible (navigation privée) : on ignore
  }
}
