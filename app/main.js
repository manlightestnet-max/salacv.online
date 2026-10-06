// Éditeur étudiant. Mobile : aperçu plein écran + formulaire dans un bottom
// sheet. PC : formulaire dans une barre de gauche redimensionnable. Aperçu
// zoomable partout ; tant que l'étudiant n'a rien saisi, l'exemple s'affiche
// en grisé pour montrer le format.
import { syncBrowserBar, toggleTheme } from './lib/theme.js';
import { layoutResume } from '../src/index.js';
import { drawDoc, loadEngine } from './lib/engine.js';
import { createProject, fetchShared, getPlan, initStore, isPersisted, isShared, getProject, isPro, setPlan, setShared, shareLink, listProjects, projectName, read, saveProject, setPro, write as store } from './lib/store.js';
import { offerSandboxSync } from './sync.js';
import { openDialog } from './dialog.js';
import { openExport } from './export.js';
import { openMultiExport } from './export-multi.js';
import { initQuickEdit } from './quickedit.js';
import { createLangBar } from './langs.js';
import { langName } from '../src/i18n/index.js';
import { openSwitcher } from './switcher.js';
import { createWorkspace } from './workspace.js';
import example from '../examples/etudiant.json';
import { h, icon, fieldIndex, setInputError } from './dom.js';
import { STEPS, reviewStatus, stepLevels } from './steps.js';
import { createAgentPanel } from './agent.js';
import { askAgent } from './ai.js';
import { initQuotaBar } from './quotabar.js';
import { getSession, initSession } from './session.js';
import { registerTemplate } from '../src/templates/index.js';
import { templateFromSpec } from '../src/templates/spec.js';
import { normalizeState, fromResume, toResume, checklist, hasGhost, TEMPLATES } from './state.js';

const $ = (id) => document.getElementById(id);
await initSession(); // qui est connecté ? (le serveur le sait par son cookie)
initQuotaBar();
const root = document.documentElement;
let stepAi = false;
let aiProposal = null; // { step, before, changed } : suggestion de l'IA en attente de Garder / Annuler
let aiPop = null;
// Rail ouvert (titres visibles) au chargement pendant 20 s, puis replié ; le bouton en bas le garde ouvert ou fermé.
let railOpen = true;
let railTimer = setTimeout(() => setRailOpen(false), 20000);
function setRailOpen(open, manual = false) {
  if (manual) clearTimeout(railTimer);
  railOpen = open;
  const rail = $('rail');
  rail.classList.toggle('expanded', open);
  const btn = rail.querySelector('.rail-expand');
  btn?.setAttribute('aria-expanded', String(open));
  btn?.setAttribute('title', open ? 'Masquer les titres' : 'Afficher les titres des étapes');
}
let seen = 0; // étape la plus avancée déjà ouverte (le rail ne juge que celles-là)
const STEP_AI = {
  identite: { q: 'Comment t’appelles-tu, quel métier vises-tu, et comment te joindre ?', part: 'l’identité et les contacts (nom, profession, email, téléphones, adresse)' },
  profil: { q: 'Qui es-tu, que sais-tu faire, et que cherches-tu ?', part: 'le profil professionnel (2 à 4 phrases)' },
  formation: { q: 'Quelles études as-tu faites ? École, diplôme, années.', part: 'la formation' },
  experience: { q: 'Où as-tu travaillé ou fait un stage, et qu’y as-tu fait ?', part: 'les expériences' },
  competences: { q: 'Qu’est-ce que tu sais faire ? Écris en vrac.', part: 'les compétences' },
  langues: { q: 'Quelles langues parles-tu (et à quel niveau), et que fais-tu de ton temps libre ?', part: 'les langues et les loisirs' },
};
const preview = $('preview');
// Rendu final impossible (pas encore de nom) : message au centre de l'aperçu, dans tous les modes.
const finalEmpty = h(
  'div',
  { class: 'final-empty', role: 'status', hidden: true },
  h('strong', {}, 'Rendu final'),
  h('p', {}, 'Écris au moins ton nom pour voir ton CV tel qu’il sera, sans le texte d’exemple en gris.'),
  h('button', { type: 'button', class: 'btn-primary', onClick: () => $('final-view').click() }, 'Revenir à l’aperçu'),
);
document.body.append(finalEmpty);
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

const ASKED_LANG = new URLSearchParams(location.search).get('lang'); // avant que l'URL soit nettoyée
// Les CV du compte (R2 / base) — ou, pour un visiteur, son bac à sable — sont chargés avant tout.
await initStore();
const synced = await offerSandboxSync(); // connecté avec des CV faits sans compte sur cet appareil : les ajouter ?
const project = await openProject(synced.ids);
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

// --- Mobile : le haut de l'écran ------------------------------------------------------------
// Tout ce qui vit en haut s'empile au centre, sans se chevaucher ni couvrir le CV : l'invitation à se connecter,
// puis la barre d'outils (zoom, rendu final, langues), puis les messages. --top-h (bas de la pile) sert à l'aperçu
// (le CV commence dessous) et à la feuille dépliée (elle se colle dessous). PC : chaque élément garde sa place.
const topStack = h('div', { class: 'top-stack' });
function placeTopStack() {
  const parts = [document.querySelector('.quota-bar'), document.querySelector('.zoombar'), document.querySelector('.topbar')].filter(Boolean);
  if (desktop.matches) {
    document.body.append(...parts);
    topStack.remove();
  } else {
    topStack.append(...parts);
    if (!topStack.isConnected) document.body.append(topStack);
  }
}
// --quota-b : bas de l'invitation à se connecter (la feuille dépliée s'arrête dessous ; sans elle, tout l'écran).
const measureTop = () => {
  root.style.setProperty('--top-h', `${Math.ceil(topStack.getBoundingClientRect().bottom)}px`);
  const quota = document.querySelector('.quota-bar');
  root.style.setProperty('--quota-b', `${quota && !quota.hidden ? Math.ceil(quota.getBoundingClientRect().bottom) : 0}px`);
};
const topObserver = new ResizeObserver(measureTop);
topObserver.observe(topStack);
if (document.querySelector('.quota-bar')) topObserver.observe(document.querySelector('.quota-bar'));
desktop.addEventListener('change', placeTopStack);
placeTopStack();

// Mobile : toucher le CV ailleurs que sur un texte → plein écran (seule la barre d'outils reste) ; re-toucher → retour.
// Toucher un texte ouvre toujours sa modification ; un premier toucher qui ne fait que désélectionner ne bascule pas.
let hadSelection = false;
preview.addEventListener('click', () => (hadSelection = Boolean(document.querySelector('.qe-bar:not([hidden])'))), true);
preview.addEventListener('click', () => {
  if (desktop.matches || hadSelection || workspace?.on || sheet.dataset.state === 'expanded') return;
  root.classList.toggle('immersive');
});
renderStep();
initEngine();

// Lune / soleil, à côté du bouton du panneau : un clic, le thème bascule.
const themeLabel = () => (root.dataset.theme === 'light' ? '☾ Passer en sombre' : '☀ Passer en clair');
function renderThemeBtn() {
  const lightOn = root.dataset.theme === 'light';
  $('theme').textContent = lightOn ? '☾' : '☀';
  $('theme').title = lightOn ? 'Passer en sombre' : 'Passer en clair';
}
$('theme').addEventListener('click', () => (toggleTheme(), renderThemeBtn()));
renderThemeBtn();
syncBrowserBar();
$('assistant').addEventListener('click', () => (agentOpen ? closeAgent() : openAgent()));
$('toggle').addEventListener('click', () => setSheet(sheet.dataset.state === 'expanded' ? 'collapsed' : 'expanded'));
$('prev').addEventListener('click', () => goTo(stepIndex - 1));
$('peek').addEventListener('click', () => setSheet('collapsed'));
$('next').addEventListener('click', () => goTo(stepIndex + 1));
$('generate').addEventListener('click', download);
$('gen-top').addEventListener('click', download);
initHorizontalScroll($('stepper'));
$('zoom-in').addEventListener('click', () => zoomBy(ZOOM.step));
$('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM.step));
$('zoom-fit').addEventListener('click', zoomFit);
$('zoom-label').addEventListener('click', () => (workspace?.on ? workspace.setZoom(1) : setZoom(1)));
$('final-view').addEventListener('click', () => {
  finalView = !finalView;
  $('final-view').setAttribute('aria-pressed', String(finalView));
  update();
  if (workspace?.on) wsRefresh();
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
$('sheet-scrim').addEventListener('click', () => setSheet('collapsed'));
initKeyboard();
initSplitter();
initPreviewGestures();

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && e.shiftKey && key === 'b' && desktop.matches) {
    e.preventDefault();
    setPreviewHidden(!root.classList.contains('preview-hidden'));
  } else if (mod && key === 'b' && desktop.matches) {
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
      replaceState: applyAiState,
      askLogin: () => openAgent(),
      // Mêmes fenêtres flottantes d'édition dans tous les modes (Lite et Pro).
      inspector: () => null,
      // Principe global : toucher un élément de l'aperçu (ou de l'espace) rend son étape active
      // dans le panneau de gauche et dans les pastilles de la feuille repliée, sans rien ouvrir.
      onSelect: (raw) => {
        const id = raw.list === 'education' ? 'formation' : raw.list === 'experiences' ? 'experience' : STEP_OF_KIND[raw.kind];
        const i = STEPS.findIndex((s) => s.id === id);
        if (i >= 0 && i !== stepIndex && !aiProposal) goTo(i);
      },
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
  // Langue demandée par l'espace infini (?lang=), puis l'espace lui-même s'il était ouvert.
  const askedLang = ASKED_LANG;
  if (askedLang && askedLang !== activeLang && (project.variants?.[askedLang] || askedLang === project.state.lang)) langBar.open(askedLang);
  if (isPro()) setWorkspace(true); // le choix Lite / Pro est une préférence d'affichage
}

// --- Bottom sheet (mobile) / barre de gauche (PC) ------------------------------

function setSheet(next) {
  sheet.dataset.state = next;
  sheet.style.transform = '';
  const open = desktop.matches || next === 'expanded';
  if (open) root.classList.remove('immersive');
  // Mobile : un chevron standard pour déplier / replier (il se retourne une fois déplié), pas de bouton texte.
  if (desktop.matches) $('toggle').replaceChildren();
  else if (!$('toggle').querySelector('svg')) $('toggle').replaceChildren(icon('chevronUp', 22));
  $('toggle').setAttribute('aria-label', next === 'expanded' ? 'Replier' : 'Déplier');
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
    root.style.setProperty('--vvt', `${vv.offsetTop}px`);
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
  $('progress').textContent = 'il remplit ton CV';
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
  // Une suggestion de l'IA attend sa réponse : ni gardée ni refusée en silence.
  if (aiProposal && guardAiProposal()) return;
  stepIndex = i;
  renderStep();
  stepEl.scrollTop = 0;
  if (workspace?.on) renderStepFab();
}

function renderStep() {
  const step = STEPS[stepIndex];
  $('stepper').replaceChildren(
    ...STEPS.map((s, i) =>
      h(
        'button',
        {
          type: 'button',
          class: `step-pill${i === stepIndex ? ' active' : ''}`,
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
  // Rail de progression (PC) : mêmes étapes, même navigation.
  seen = Math.max(seen, stepIndex);
  $('rail').replaceChildren(
    h('span', { class: 'rail-count', 'aria-hidden': 'true' }, `${stepIndex + 1}/${STEPS.length}`),
    ...STEPS.map((s, i) =>
      h(
        'button',
        {
          type: 'button',
          class: `rail-step${i === STEPS.length - 1 ? ' rail-flag' : ''}${i === stepIndex ? ' active' : ''}`,
          'data-i': i,
          style: `--i:${i}`,
          'data-label': s.label,
          'aria-label': `Étape ${i + 1} : ${s.label}`,
          'aria-current': i === stepIndex ? 'step' : null,
          onClick: () => goTo(i),
        },
        i === STEPS.length - 1 ? [FLAG_SVG(), h('span', { class: 'rail-flag-label' })] : String(i + 1),
      ),
    ),
  );
  $('rail').append(
    h('button', { type: 'button', class: 'rail-expand', 'aria-expanded': String(railOpen), title: railOpen ? 'Masquer les titres' : 'Afficher les titres des étapes', 'aria-label': 'Afficher ou masquer les titres des étapes', onClick: () => setRailOpen(!railOpen, true) }, icon('chevrons', 16)),
  );
  setRailOpen(railOpen);
  updateRailFlag();
  ctx.onAdd = null;
  // Chaque étape bascule entre Formulaire et ✦ IA, comme les fenêtres flottantes.
  const ai = STEP_AI[step.id];
  const tabs = ai
    ? h(
        'div',
        { class: 'qe-tabs step-tabs', role: 'tablist' },
        ['Formulaire', '✦ IA'].map((label, i) =>
          h('button', { type: 'button', role: 'tab', class: 'qe-tab', 'aria-selected': String(stepAi === (i === 1)), onClick: () => ((stepAi = i === 1), renderStep()) }, label),
        ),
      )
    : null;
  // Changer d'étape garde la proposition en cours.
  if (aiProposal && aiProposal.step !== step.id) aiProposal = null;
  stepEl.replaceChildren(h('div', { class: 'fade' }, tabs, ai && stepAi ? stepAiPane(ai) : step.render(ctx)));
  mountAiProposal();
  $('step-title').textContent = step.label;
  $('progress').textContent = `${stepIndex + 1}/${STEPS.length}`;
  renderTitle();
  $('prev').hidden = stepIndex === 0;
  $('next').style.visibility = stepIndex === STEPS.length - 1 ? 'hidden' : 'visible';
  sheet.classList.toggle('last-step', stepIndex === STEPS.length - 1); // mobile : « Générer » prend la place de « Suivant »
  renderMobileProgress();
  updatePills();
}

// Mobile : barre de progression en bas, une case par étape, avec les signalements du rail du PC (étapes déjà vues) :
// rouge = point obligatoire manquant, jaune = conseil, couleur pleine = complète ; la dernière case est la vérification.
function renderMobileProgress() {
  const levels = stepLevels(state, current?.doc);
  const review = reviewStatus(state, current?.doc);
  const segs = STEPS.map((s, i) => {
    const last = i === STEPS.length - 1;
    const level = last ? (seen >= i ? review.level : '') : i <= seen && i !== stepIndex ? levels[s.id] : '';
    return h('button', {
      type: 'button',
      class: `mp-seg${i === stepIndex ? ' active' : ''}`,
      'data-level': level,
      'aria-label': `Étape ${i + 1} : ${s.label}${level === 'todo' ? ' (à corriger)' : level === 'warn' ? ' (conseil)' : level === 'ok' ? ' (complète)' : ''}`,
      'aria-current': i === stepIndex ? 'step' : null,
      onClick: () => goTo(i),
    });
  });
  const todo = STEPS.filter((s, i) => i <= seen && levels[s.id] === 'todo' && s.id !== 'verification').length;
  $('mprogress').replaceChildren(
    h('div', { class: 'mp-segs' }, segs),
    h('p', { class: 'mp-label' }, h('strong', {}, STEPS[stepIndex].label), ` · ${stepIndex + 1}/${STEPS.length}`, todo > 0 && h('span', { class: 'mp-todo' }, ` · ${todo} à corriger`)),
  );
}

// Élément du CV → son étape.
const STEP_OF_KIND = { identity: 'identite', contact: 'identite', photo: 'identite', summary: 'profil', skills: 'competences', language: 'langues', hobbies: 'langues' };

// Pastilles de la feuille repliée : mêmes signalements que le rail et la progression du bas.
function updatePills() {
  const levels = stepLevels(state, current?.doc);
  const review = reviewStatus(state, current?.doc);
  document.querySelectorAll('#stepper .step-pill').forEach((pill, i) => {
    const last = i === STEPS.length - 1;
    const level = i === stepIndex ? '' : last ? (seen >= i ? review.level : '') : i <= seen ? levels[STEPS[i].id] : '';
    pill.dataset.level = level;
    const num = pill.querySelector('.step-num');
    if (num) num.replaceChildren(level === 'ok' ? icon('check', 12) : level === 'todo' ? '!' : String(i + 1));
  });
}

// Étape Vérification du rail : un drapeau rouge (erreur), jaune (conseil) ou vert (prêt), toujours déplié.
function FLAG_SVG() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M5 21V4m0 0h11l-2 4 2 4H5" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

// Étapes déjà vues : rouge « ! » (point obligatoire manquant), jaune (conseil) ou ✓ (complet).
// Les étapes pas encore vues restent neutres.
function updateRailSteps() {
  const levels = stepLevels(state, current?.doc);
  document.querySelectorAll('.rail-step[data-i]:not(.rail-flag)').forEach((b) => {
    const i = Number(b.dataset.i);
    const level = i <= seen && i !== stepIndex ? levels[STEPS[i].id] : null;
    b.dataset.level = level ?? '';
    b.replaceChildren(level === 'ok' ? icon('check', 15) : level === 'todo' ? icon('alert', 15) : String(i + 1));
    b.classList.toggle('done', level === 'ok');
    b.setAttribute('aria-label', `Étape ${i + 1} : ${STEPS[i].label}${level === 'todo' ? ' (à corriger)' : level === 'warn' ? ' (conseil)' : level === 'ok' ? ' (complète)' : ''}`);
  });
}

function updateRailFlag() {
  updateRailSteps();
  renderMobileProgress();
  updatePills();
  const flag = document.querySelector('.rail-flag');
  if (!flag) return;
  const { level, label } = reviewStatus(state, current?.doc);
  flag.dataset.level = level;
  flag.querySelector('.rail-flag-label').textContent = label;
  flag.setAttribute('aria-label', `Vérification : ${label}`);
}

// L'IA renvoie un CV : on garde photo, modèle et langue.
function applyAiState(next) {
  const { photo } = state.profile;
  const { template, lang } = state;
  state = normalizeState(next);
  Object.assign(state, { template, lang });
  state.profile.photo = photo;
  schedule();
}

// --- Mode IA par étape -------------------------------------------------------------
// La question en haut (on reste dans le contexte), on écrit en vrac, l'IA met en forme.
// L'agent de l'étape : une vraie conversation (il garde le fil, peut poser une question),
// limité aux outils de cette section. Son résultat arrive d'abord comme une proposition
// dans le formulaire : on voit, puis on garde ou on annule.
const stepChats = {};
function stepAiPane(ai) {
  const stepId = STEPS[stepIndex].id;
  const chat = (stepChats[stepId] ??= []);
  const log = h('div', { class: 'step-chat' }, chat.map((m) => h('p', { class: `step-msg ${m.role}` }, m.text)));
  const text = h('textarea', { class: 'input', rows: 3, placeholder: chat.length ? 'Réponds, ou précise…' : 'Écris comme tu parles, même en vrac…' });
  const status = h('p', { class: 'qe-ai-status', 'aria-live': 'polite' });
  const go = h('button', { type: 'button', class: 'btn-primary qe-ai-go' }, '✦ Envoyer');
  const send = async () => {
    const said = text.value.trim();
    if (!said) return text.focus();
    go.disabled = true;
    status.textContent = 'L’IA écrit…';
    const r = await askAgent(state, said, { scope: stepId, history: chat.slice(-8) });
    go.disabled = false;
    if (!r.ok) {
      status.textContent = r.error ?? 'L’IA n’a pas pu répondre. Réessaie.';
      if (r.login) status.append(' ', h('button', { type: 'button', class: 'btn-text', onClick: () => openAgent() }, 'Me connecter'));
      return;
    }
    chat.push({ role: 'user', text: said }, { role: 'assistant', text: r.reply ?? '' });
    if (r.changes?.length) {
      // Proposition : visible dans le formulaire et sur le CV, rien n'est définitif.
      const before = structuredClone(state);
      aiProposal = { step: stepId, before };
      applyAiState(r.state);
      aiProposal.changed = changedTargets(before, state);
      stepAi = false;
    }
    renderStep();
  };
  go.addEventListener('click', send);
  text.addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), send()));
  setTimeout(() => (text.focus(), (log.scrollTop = log.scrollHeight)), 50);
  return h(
    'div',
    { class: 'step qe-ai step-ai' },
    h('p', { class: 'qe-ai-question' }, ai.q),
    chat.length ? log : h('p', { class: 'qe-ai-hint' }, 'L’IA ne touche que cette section, sans rien inventer. Tu vois sa proposition avant de la garder.'),
    text,
    h('div', { class: 'qe-ai-row' }, status, go),
  );
}

// Champs que l'IA vient de modifier : [{ obj, key }] (la clé '_' désigne toute une liste).
function changedTargets(before, after) {
  const out = [];
  const differs = (x, y) => JSON.stringify(x ?? null) !== JSON.stringify(y ?? null);
  for (const key of Object.keys(after.profile)) {
    if (key === 'photo') continue;
    if (differs(before.profile[key], after.profile[key])) out.push({ obj: after.profile, key: Array.isArray(after.profile[key]) ? '_' : key, list: Array.isArray(after.profile[key]) ? after.profile[key] : null });
  }
  for (const k of ['education', 'experiences', 'languages']) {
    after[k].forEach((item, i) => {
      const old = before[k][i];
      if (!old) return out.push({ obj: item, key: '_card' });
      for (const key of Object.keys(item)) if (differs(old[key], item[key])) out.push({ obj: item, key });
    });
  }
  for (const k of ['skills', 'hobbies']) if (differs(before[k], after[k])) out.push({ obj: after[k], key: '_' });
  return out;
}

// Retrouve le champ d'une cible dans le formulaire affiché ; un bloc replié → le bloc entier.
function resolveTarget(t) {
  const target = fieldIndex.get(t.list ?? t.obj)?.[t.list ? '_' : t.key];
  const card = fieldIndex.get(t.obj)?._card;
  if (target?.root.isConnected && target.root.getBoundingClientRect().height > 0) return target;
  return card?.root.isConnected ? { root: card.root, input: card.input } : null;
}

const AI_PENDING_MESSAGE = 'Veuillez accepter ou annuler la suggestion de l’IA avant de continuer.';

function aiAnchor() {
  const found = (aiProposal?.changed ?? []).map(resolveTarget).filter(Boolean);
  // Ancrage : le dernier champ modifié, pour que la fenêtre ne recouvre aucun champ à relire.
  return { all: found, first: found.at(-1) ?? null };
}

function removeAiPop() {
  aiPop?.remove();
  aiPop = null;
  stepEl.removeEventListener('scroll', placeAiPop);
  window.removeEventListener('resize', placeAiPop);
}

// La fenêtre se pose sous le champ concerné, alignée à son bord droit, sans sortir de l'écran.
function placeAiPop() {
  const { first } = aiAnchor();
  if (!aiPop || !first) return;
  const r = first.root.getBoundingClientRect();
  const view = stepEl.getBoundingClientRect();
  aiPop.hidden = r.bottom < view.top + 4 || r.top > view.bottom - 4;
  const w = Math.min(340, innerWidth - 16);
  aiPop.style.width = `${w}px`;
  const hgt = aiPop.offsetHeight || 150;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  const fitsBelow = r.bottom + 8 + hgt <= innerHeight - 8;
  const top = fitsBelow ? r.bottom + 8 : Math.max(8, r.top - hgt - 8);
  aiPop.style.left = `${left}px`;
  aiPop.style.top = `${top}px`;
  aiPop.classList.toggle('above', !fitsBelow);
}

function endAiProposal(keep) {
  if (!keep) {
    state = normalizeState(aiProposal.before);
    schedule();
  }
  aiProposal = null;
  removeAiPop();
  renderStep();
}

function mountAiProposal() {
  removeAiPop();
  if (!aiProposal || aiProposal.step !== STEPS[stepIndex].id || stepAi) return;
  const { all, first } = aiAnchor();
  if (!first) return;
  all.forEach((t) => t.root.classList.add('ai-changed'));
  const many = all.length > 1;
  aiPop = h(
    'div',
    { class: 'ai-pop', role: 'dialog', 'aria-label': 'Suggestion de l’IA' },
    h('strong', { class: 'ai-pop-title' }, '✦ Suggestion de l’IA'),
    h('p', {}, many ? `${all.length} champs ont été remplis ou corrigés (en surbrillance). Relis-les, puis garde ou annule.` : 'Ce champ a été rempli ou corrigé. Relis-le, puis garde ou annule.'),
    h(
      'div',
      { class: 'ai-pop-actions' },
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => endAiProposal(false) }, 'Annuler'),
      h('button', { type: 'button', class: 'btn-primary', onClick: () => endAiProposal(true) }, 'Garder'),
    ),
  );
  document.body.append(aiPop);
  stepEl.addEventListener('scroll', placeAiPop, { passive: true });
  window.addEventListener('resize', placeAiPop);
  placeAiPop();
  requestAnimationFrame(placeAiPop); // 2e passage : la mise en page du formulaire est finie
}

// Appelé quand l'étudiant veut quitter l'étape : vrai si une suggestion attend encore.
function guardAiProposal() {
  const { first } = aiAnchor();
  if (!first) {
    aiProposal = null;
    return false;
  }
  if (sheet.dataset.state !== 'expanded' && !desktop.matches) setSheet('expanded');
  setInputError(first.root, first.input, AI_PENDING_MESSAGE);
  placeAiPop();
  return true;
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
  // Rendu final d'un CV encore vide : surtout pas l'ancien aperçu (il montre le texte d'exemple en
  // gris) ; on le masque et on explique, avec un moyen de revenir.
  const blank = finalView && !result.ok;
  finalEmpty.hidden = !blank;
  if (blank) $('ghost-note').hidden = true;
  preview.classList.toggle('final-blank', blank);
  if (!result.ok) return; // sinon, on garde le dernier aperçu valide
  current = result;
  // Pendant un message (toast), l'aide attend son tour.
  if (!note.classList.contains('toast')) {
    note.textContent = finalView ? 'Rendu final : seulement ce que tu as rempli' : 'Touche un texte pour le modifier · gris = exemple';
    note.hidden = !finalView && !hasGhost(result.resume);
  }
  paint(result.doc);
  updateRailFlag();
  paintThumbs();
  langBar.render(); // ↻ quand une traduction est en retard sur l'original
  // Mode Pro : le nom du CV actif suit la profession saisie.
  if (workspace?.on) {
    const label = document.querySelector('.ws-group.active .ws-group-label');
    if (label) label.textContent = docLabel(curDoc());
    if (!pickerOpen) renderPicker();
  }
}

// --- Choix du modèle ------------------------------------------------------------
// Une carte par modèle, avec une miniature du CV de l'étudiant dans ce modèle.

const THUMB = { w: 42, h: 59 };
function makeThumb(t) {
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
        applyTplSettings();
        schedule();
        // La vignette photo de l'étape Identité prend la forme du nouveau modèle.
        if (STEPS[stepIndex].id === 'identite' && !agentOpen) renderStep();
      },
    },
    canvas,
    h('span', {}, t.name),
  );
  return { id: t.id, canvas, card, surface: null };
}
const thumbs = TEMPLATES.map(makeThumb);
$('templates').replaceChildren(...thumbs.map((t) => t.card));

// Modèles gérés par l'admin : disponible ou non, et pour qui (tous, Lite, Pro). Le modèle
// déjà choisi pour un CV reste visible, même retiré, pour ne rien casser.
let tplSettings = {};
function templateVisible(id, current) {
  const s = tplSettings[id];
  if (id === current) return true;
  if (s && s.enabled === false) return false;
  const aud = s?.audience ?? 'all';
  return aud === 'all' || aud === (isPro() ? 'pro' : 'lite');
}
function applyTplSettings() {
  thumbs.forEach((t) => (t.card.hidden = !templateVisible(t.id, state.template)));
}
fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then((r) => r.json())
  .then((r) => {
    if (!r.ok) return;
    tplSettings = r.templates ?? {};
    // Modèles téléversés par l'admin (DSL) : enregistrés dans le moteur et proposés.
    for (const spec of r.specs ?? []) {
      try {
        registerTemplate(templateFromSpec(spec));
      } catch {
        continue;
      }
      if (TEMPLATES.some((t) => t.id === spec.id)) continue;
      TEMPLATES.push({ id: spec.id, name: spec.name });
      const t = makeThumb({ id: spec.id, name: spec.name });
      thumbs.push(t);
      $('templates').append(t.card);
    }
    applyTplSettings();
    if (engine) {
      pickerCache = { key: '', items: [] };
      update();
    }
  })
  .catch(() => {});

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
  // Espace infini : les pages vont dans le cadre actif, à taille réelle ; la caméra zoome.
  const inWs = workspace?.on && workspace.activeHost();
  const host = inWs ? workspace.activeHost() : canvases;
  const z = inWs ? 1 : zoom.fit ? fitZoom(doc) : zoom.value;
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min((inWs ? workspace.zoom : z) * dpr, MAX_BACKING_SCALE);
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
    el.className = 'page';
    pages.push({ el, surface: null });
  }
  for (const p of pages) if (p.el.parentNode !== host) host.append(p.el);
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

  if (inWs) return;
  placeLiteTpl(z);
  $('zoom-label').textContent = `${Math.round(z * 100)} %`;
  $('zoom-fit').classList.toggle('active', zoom.fit);
}

// Zoom en gardant le même point au centre de l'aperçu.
// anchor : le point de l'aperçu (coordonnées écran) qui ne bouge pas pendant le zoom —
// le centre par défaut, le milieu des deux doigts au pincement.
function setZoom(value, fit = false, anchor = null) {
  if (!current) return;
  const r = preview.getBoundingClientRect();
  const ax = anchor ? anchor.x - r.left : preview.clientWidth / 2;
  const ay = anchor ? anchor.y - r.top : preview.clientHeight / 2;
  const cx = (preview.scrollLeft + ax) / preview.scrollWidth;
  const cy = (preview.scrollTop + ay) / preview.scrollHeight;
  zoom = { fit, value: Math.max(ZOOM.min, Math.min(ZOOM.max, value)) };
  paint(current.doc);
  preview.scrollLeft = cx * preview.scrollWidth - ax;
  preview.scrollTop = cy * preview.scrollHeight - ay;
}

function currentZoom() {
  return zoom.fit && current ? fitZoom(current.doc) : zoom.value;
}

function zoomBy(factor) {
  if (workspace?.on) return workspace.zoomBy(factor);
  setZoom(currentZoom() * factor);
}

function zoomFit() {
  if (workspace?.on) return workspace.fit();
  setZoom(1, true);
}

// Ctrl + molette (et pincement du pavé tactile) sur PC, pincement à deux doigts sur mobile.
function initPreviewGestures() {
  preview.addEventListener(
    'wheel',
    (e) => {
      if (workspace?.on || (!e.ctrlKey && !e.metaKey)) return;
      e.preventDefault();
      // Un cran de molette (~100) ≈ ×0,82 ; le pincement du pavé tactile envoie de petits pas.
      const delta = Math.max(-50, Math.min(50, e.deltaY));
      setZoom(currentZoom() * Math.exp(-delta * 0.004));
    },
    { passive: false },
  );

  // Mobile : pincement à deux doigts. Pendant le geste, simple mise à l'échelle CSS (fluide,
  // pas de rendu à chaque image) autour du milieu des doigts ; au relâcher, un seul vrai
  // rendu au bon zoom, et la page reste là où on l'a amenée (jamais renvoyée en haut).
  // Événements touch (pas pointer) : le navigateur annule les pointeurs dès qu'il défile.
  let pinch = null;
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  preview.addEventListener(
    'touchstart',
    (e) => {
      if (workspace?.on || e.touches.length !== 2 || !current) return;
      const m = mid(e.touches);
      const r = canvases.getBoundingClientRect();
      pinch = { d: dist(e.touches), zoom: currentZoom(), m, f: 1, ox: m.x - r.left, oy: m.y - r.top };
      canvases.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
      // Le navigateur ne défile plus pendant le pincement : il ne nous vole pas le geste.
      preview.style.overflow = 'hidden';
    },
    { passive: true },
  );
  preview.addEventListener(
    'touchmove',
    (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const z = Math.max(ZOOM.min, Math.min(ZOOM.max, pinch.zoom * (dist(e.touches) / pinch.d)));
      pinch.f = z / pinch.zoom;
      const m = mid(e.touches);
      canvases.style.transform = `translate(${m.x - pinch.m.x}px, ${m.y - pinch.m.y}px) scale(${pinch.f})`;
      pinch.last = m;
    },
    { passive: false },
  );
  const endPinch = () => {
    if (!pinch) return;
    const p = pinch;
    pinch = null;
    const m = p.last ?? p.m;
    // Le point du CV qui était sous les doigts au départ finit sous les doigts à l'arrivée.
    const r0 = preview.getBoundingClientRect();
    const px = preview.scrollLeft + p.m.x - r0.left;
    const py = preview.scrollTop + p.m.y - r0.top;
    canvases.style.transform = '';
    preview.style.overflow = '';
    zoom = { fit: false, value: p.zoom * p.f };
    paint(current.doc);
    preview.scrollLeft = px * p.f - (m.x - r0.left);
    preview.scrollTop = py * p.f - (m.y - r0.top);
  };
  preview.addEventListener('touchend', (e) => e.touches.length < 2 && endPinch());
  preview.addEventListener('touchcancel', endPinch);
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

// Un projet peut contenir plusieurs CV (mode Pro) : le CV principal (le projet lui-même)
// et project.docs. Chaque CV a sa famille de langues (state + variants).
let activeDoc = 'main';
project.docs ??= [];
function curDoc() {
  return activeDoc === 'main' ? project : project.docs.find((d) => d.id === activeDoc) ?? project;
}
const docLabel = (d) => (d === project && project.name?.trim()) || (d.styled && d.cvName) || normalizeState(d.state).profile.title.trim() || d.cvName?.trim() || (d === project ? 'CV principal' : 'Nouveau CV');

// Passer à un autre CV du projet (et à l'une de ses langues), sans recharger.
function switchDoc(id, lang, { focus = false } = {}) {
  saveCurrent();
  activeDoc = id;
  const d = curDoc();
  d.variants ??= {};
  activeLang = lang && (lang === d.state.lang || d.variants[lang]) ? lang : d.state.lang;
  state = normalizeState(activeLang === d.state.lang ? d.state : d.variants[activeLang]);
  langBar.render();
  renderStep();
  // Tout de suite (pas de délai), et dans cet ordre : d'abord les cadres (le nouvel actif
  // reçoit les pages), puis le rendu — jamais l'ancien cadre repeint avec le nouveau CV.
  if (workspace?.on) workspace.render(wsRows());
  update();
  if (workspace?.on) {
    renderPicker();
    renderStepFab();
    if (focus) workspace.focusActive();
  }
}

// Nouveau CV dans le projet : mêmes informations, nouvelle profession à écrire.
function addDoc() {
  const base = normalizeState(structuredClone(state));
  base.profile.title = '';
  base.profile.summary = '';
  const doc = { id: Math.random().toString(36).slice(2, 9), cvName: `CV ${project.docs.length + 2}`, state: base, variants: {} };
  project.docs.push(doc);
  switchDoc(doc.id, null, { focus: true });
  toast('Nouveau CV dans le projet : écris la profession, le reste est déjà là.');
}

// Duplique un CV du projet : mêmes informations, modèle, photo et versions de langue, sous un nouveau nom.
function duplicateDoc(d) {
  saveCurrent(); // ce qui est en cours d'édition est d'abord enregistré dans son CV
  const name = `${docLabel(d)} (copie)`;
  const copy = {
    id: Math.random().toString(36).slice(2, 9),
    cvName: name,
    styled: true,
    state: structuredClone(d.state),
    variants: structuredClone(d.variants ?? {}),
    translatedFrom: structuredClone(d.translatedFrom ?? {}),
  };
  const at = d === project ? 0 : project.docs.indexOf(d) + 1;
  project.docs.splice(at, 0, copy); // juste après l'original
  saveProject(project);
  pickerOpen = false;
  switchDoc(copy.id, null, { focus: true });
  toast(`CV dupliqué : « ${name} ». Renomme-le avec un double-clic dans la liste.`);
}

function saveCurrent() {
  const doc = curDoc();
  if (activeLang === doc.state.lang) doc.state = state;
  else (doc.variants ??= {})[activeLang] = state;
  saveProject(project);
  flashSaved();
  renderTitle();
}

// Sauvegarde automatique (à chaque modification) : on la montre, discrètement.
let savedTimer;
// L'indicateur d'enregistrement suit ce que fait VRAIMENT la synchronisation (lib/store.js).
function flashSaved() {}
const SAVE_TEXT = {
  saving: [' · Enregistrement…', false],
  saved: [' · Enregistré ✓', true],
  error: [' · Échec de l’enregistrement, nouvel essai…', false],
  local: [' · Sur cet appareil', false],
  refused: [' · Non enregistré', false],
};
window.addEventListener('salacv:save', (e) => {
  const [text, done] = SAVE_TEXT[e.detail.state] ?? SAVE_TEXT.saved;
  const el = $('saved');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('done', done);
});
window.addEventListener('salacv:save-refused', (e) => toast(e.detail?.error || 'Ce CV n’a pas pu être enregistré.'));
// CV qui ne serait gardé nulle part (navigateur qui refuse le bac à sable du visiteur) : on prévient avant de quitter.
window.addEventListener('beforeunload', (e) => {
  if (!isPersisted() && state?.profile?.name?.trim()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Titre du CV en haut à gauche : un clic pour le renommer.
function renderTitle() {
  const btn = $('cv-title');
  if (btn.querySelector('input')) return;
  btn.textContent = projectName(project);
}
// Un clic sur le titre du CV : son espace de travail (Mes CV) si connecté, sinon la fenêtre du CV.
// Le modèle ne s'ouvre jamais par le titre : bouton « Modèle » de la barre d'outils.
$('cv-title').addEventListener('click', () => (getSession() ? openSwitcher({ engine, project, state }) : openCvDialog({ templates: false })));
$('tpl-btn').addEventListener('click', () => openCvDialog({ templates: true }));
// Nom et partage du CV ; avec la liste des modèles seulement depuis le bouton « Modèle ».
function openCvDialog({ templates = true } = {}) {
  const tpl = $('templates');
  const parking = $('templates-parking'); // place fixe : la liste y revient toujours, même si deux fenêtres se suivent
  const input = h('input', { class: 'cv-name-input', value: project.name ?? '', placeholder: projectName({ ...project, name: '' }), maxlength: 60, 'aria-label': 'Nom du CV' });
  input.addEventListener('input', () => {
    project.name = input.value.trim();
    saveCurrent();
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), d.close()));
  if (templates) tpl.classList.add('in-dialog');
  const d = openDialog({
    title: templates ? 'Modèle' : 'Ce CV',
    className: 'cv-dialog',
    content: [
      h('label', { class: 'cv-dialog-label' }, 'Nom', input),
      templates && h('p', { class: 'cv-dialog-label' }, 'Modèle'),
      templates && tpl,
      shareBlock(),
      // Mobile : « Mes CV » vit ici (plus de logo dans la barre de la sheet).
      h('button', { type: 'button', class: 'btn-ghost cv-mine', onClick: () => (d.close(), openSwitcher({ engine, project, state })) }, 'Mes CV'),
      // Mobile : le thème vit ici (la barre de la sheet reste légère).
      h('button', { type: 'button', class: 'btn-ghost cv-theme', onClick: (e) => (toggleTheme(), renderThemeBtn(), (e.currentTarget.textContent = themeLabel())) }, themeLabel()),
    ],
    footer: [h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => d.close() }, 'Terminé')],
    onClose: () => {
      tpl.classList.remove('in-dialog');
      parking.append(tpl);
    },
  });
  if (templates && engine) paintThumbs();
}
$('switch').addEventListener('click', () => openSwitcher({ engine, project, state }));

// Partage : privé par défaut ; public, le lien s'ouvre chez n'importe qui, qui peut en faire sa copie.
function shareBlock() {
  if (!getSession()) {
    return h('div', { class: 'share' }, h('p', { class: 'cv-dialog-label' }, 'Partage'), h('p', { class: 'share-text' }, 'Lien privé. Connecte-toi pour pouvoir le rendre public.'));
  }
  const text = h('p', { class: 'share-text' });
  const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-label': 'Lien public' }, h('span', { 'aria-hidden': 'true' }));
  const copy = h('button', { type: 'button', class: 'btn-ghost share-copy' }, 'Copier le lien');
  const render = () => {
    const on = isShared(project.id);
    sw.setAttribute('aria-checked', String(on));
    text.textContent = on ? 'Public : tout le monde avec le lien peut le voir et le dupliquer.' : 'Privé : toi seul l’ouvres.';
    copy.hidden = !on;
  };
  sw.addEventListener('click', async () => {
    sw.disabled = true;
    const r = await setShared(project.id, !isShared(project.id));
    sw.disabled = false;
    if (!r.ok) toast(r.error);
    render();
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLink(project.id));
      copy.textContent = 'Lien copié';
    } catch {
      copy.textContent = shareLink(project.id);
    }
  });
  render();
  return h('div', { class: 'share' }, h('div', { class: 'share-row' }, h('p', { class: 'cv-dialog-label' }, 'Lien public'), sw), text, copy);
}

// PC : l'aperçu se masque aussi, pour travailler le formulaire en grand.
function setPreviewHidden(hidden) {
  root.classList.toggle('preview-hidden', hidden);
  $('show-preview').hidden = !hidden;
  store('salacv:preview-hidden', hidden ? '1' : '0');
  if (!hidden && engine) repaint();
}
$('hide-preview').addEventListener('click', () => setPreviewHidden(true));
$('show-preview').addEventListener('click', () => setPreviewHidden(false));
setPreviewHidden(read('salacv:preview-hidden') === '1' && desktop.matches);

const langBar = createLangBar({
  // Le CV actif du projet (le projet lui-même, ou l'un de ses CV en mode Pro).
  get project() {
    return curDoc();
  },
  getState: () => state,
  getLang: () => activeLang,
  switchTo(lang, next) {
    saveCurrent();
    activeLang = lang;
    state = next;
    renderStep();
    schedule();
    if (workspace?.on) setTimeout(wsRefresh, 120);
  },
  save: saveCurrent,
  changed: () => workspace?.on && wsRefresh(),
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

// --- Espace infini (mode Pro) ----------------------------------------------------------
// Tous les CV et leurs langues côte à côte ; le cadre actif est le CV en cours d'édition.
let workspace = null;

// Mises en page des cadres inactifs, gardées tant que le CV ne change pas.
const wsLayouts = new Map();
function wsRows() {
  const docOf = (st) => {
    // Rendu final : tous les cadres, pas seulement l'actif.
    const key = `${finalView ? 'final' : 'ghost'}|${JSON.stringify(st)}`;
    if (!wsLayouts.has(key)) {
      if (wsLayouts.size > 40) wsLayouts.clear();
      const r = layoutResume(toResume(normalizeState(st), finalView ? {} : { mockup: example }), engine.fonts, { watermark: WATERMARK });
      wsLayouts.set(key, r.ok ? r.doc : null);
    }
    return wsLayouts.get(key);
  };
  // Une ligne = un CV du projet (sa famille de langues), une colonne = une langue.
  return [project, ...project.docs].map((d) => {
    const id = d === project ? 'main' : d.id;
    const versions = [[d.state.lang, d.state], ...Object.entries(d.variants ?? {}).filter(([l]) => l !== d.state.lang)];
    const tpl = TEMPLATES.find((t) => t.id === d.state.template) ?? TEMPLATES[0];
    return {
      id,
      label: docLabel(d),
      template: { id: tpl.id, name: tpl.name, doc: docOf(id === activeDoc ? state : d.state) },
      picker: tplPickFor === id ? pickerDocs(id) : null,
      ...langRow(d, id),
      frames: versions.map(([lang, st]) => {
        const active = id === activeDoc && lang === activeLang;
        return { key: `${id}:${lang}`, label: String(lang).toUpperCase(), active, pages: active ? current?.doc.pages.length ?? 1 : 1, doc: active ? null : docOf(st) };
      }),
    };
  });
}

// Bascule de langues du conteneur d'un CV : une pastille par version, ↻ pour retraduire par l'IA.
function langRow(d, id) {
  const mainLang = d.state.lang;
  const langs = [mainLang, ...Object.keys(d.variants ?? {}).filter((l) => l !== mainLang)];
  const isActive = id === activeDoc;
  const lang = isActive && activeLang !== mainLang ? activeLang : null; // l'original n'est pas une traduction
  const busy = Boolean(lang && langBar.busy(lang));
  const stale = Boolean(lang && langBar.stale(lang, d));
  let title = 'La version originale n’est pas traduite : choisis une autre langue pour la retraduire (IA)';
  if (lang) title = langBar.online() ? `Retraduire la version ${langName(lang)} depuis l’original (IA)${stale ? ' · l’original a changé' : ''}` : `Retraduire la version ${langName(lang)} (IA) : pas de connexion Internet`;
  return {
    langs: langs.map((l) => ({ lang: l, name: langName(l) + (l === mainLang ? ' · originale' : ''), active: isActive && l === activeLang, busy: isActive && langBar.busy(l) })),
    refresh: { lang, busy, stale, title },
  };
}

// Actions des langues d'un conteneur : on passe d'abord sur ce CV, puis on agit comme dans Lite.
function wsLang(id, action, lang) {
  if (id !== activeDoc) switchDoc(id);
  if (action === 'open') langBar.open(lang);
  else if (action === 'refresh') langBar.refresh(lang);
  else if (action === 'add') langBar.add();
}
window.addEventListener('online', () => workspace?.on && wsRefresh());
window.addEventListener('offline', () => workspace?.on && wsRefresh());

function wsRefresh() {
  if (!workspace?.on) return;
  workspace.render(wsRows());
  if (current) paint(current.doc);
  renderPicker();
  renderStepFab();
}

// Lite : le même bouton « modèle » à droite de la page, et la même carte, accrochée à la
// page (elle suit le défilement et le zoom comme la page). Reste ouverte jusqu'au choix.
let liteTplOpen = false;
const liteTpl = h('div', { class: 'lite-tpl' });
function placeLiteTpl(z) {
  const page = pages[0]?.el;
  if (workspace?.on || !page || !engine) return liteTpl.remove();
  if (liteTpl.parentNode !== canvases) canvases.append(liteTpl);
  const tpl = TEMPLATES.find((t) => t.id === state.template) ?? TEMPLATES[0];
  const chip = h('button', { type: 'button', class: 'ws-group-tpl lite-chip', onClick: () => ((liteTplOpen = !liteTplOpen), placeLiteTpl(z), liteTplOpen && requestAnimationFrame(() => liteTpl.scrollIntoView({ inline: 'end', block: 'nearest', behavior: 'smooth' }))) }, h('span', {}, tpl.name), h('span', { 'aria-hidden': 'true' }, liteTplOpen ? '▴' : '▾'));
  const parts = [chip];
  if (liteTplOpen) {
    const card = tplCardEl(pickerDocs('main'), (id) => ((liteTplOpen = false), pickTemplate('main', id)), () => openTplStudio('main'));
    const k = Math.min(1.2, Math.max(0.5, z * 0.8));
    card.style.transform = `scale(${k})`;
    parts.push(card);
    // Place réservée à droite de la page : la carte ne recouvre rien, l'aperçu défile.
    canvases.style.paddingRight = `${Math.round(410 * k + 70)}px`;
  } else canvases.style.paddingRight = '';
  liteTpl.replaceChildren(...parts);
  Object.assign(liteTpl.style, { left: `${page.offsetLeft + page.offsetWidth + 14}px`, top: `${page.offsetTop}px` });
}
// La carte des modèles (espace Pro et Lite).
function tplCardEl(items, onPick, onExpand) {
  return h(
    'div',
    { class: 'ws-tpl-card' },
    h('div', { class: 'ws-tpl-card-head' }, h('strong', {}, 'Modèles'), h('button', { type: 'button', class: 'btn-ghost ws-tpl-expand', onClick: (e) => (e.stopPropagation(), onExpand()) }, '⤢ Agrandir')),
    items.map((t) => {
      const c = h('canvas', { class: 'tpl-thumb' });
      if (t.doc) requestAnimationFrame(() => drawDoc(engine, c, t.doc, 50));
      return h('button', { type: 'button', class: 'tpl-pop-item', 'aria-selected': String(t.selected), onClick: (e) => (e.stopPropagation(), onPick(t.id)) }, c, h('span', {}, t.name));
    }),
  );
}

// Choix du modèle d'un CV de l'espace : les modèles s'ouvrent DANS l'espace, sous le
// conteneur, chacun montrant ce CV dans ce modèle ; on zoome, on compare, on touche.
let tplPickFor = null;
function openTplPicker(id) {
  tplPickFor = tplPickFor === id ? null : id;
  wsRefresh();
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && !tplStudio && (tplPickFor || liteTplOpen) && ((tplPickFor = null), (liteTplOpen = false), wsRefresh(), repaint()));
function pickTemplate(id, tpl) {
  const doc = id === 'main' ? project : project.docs.find((d) => d.id === id);
  if (!doc) return;
  // Toutes les langues de ce CV prennent le modèle.
  for (const v of [doc.state, ...Object.values(doc.variants ?? {})]) v.template = tpl;
  if (id === activeDoc) state.template = tpl;
  saveProject(project);
  tplPickFor = null;
  if (id === activeDoc) update();
  wsRefresh();
  toast(`Modèle « ${TEMPLATES.find((t) => t.id === tpl)?.name} » appliqué.`);
}
// Les modèles en grand, dans un dialogue interne au panneau de droite (l'aperçu) : chaque
// modèle montre ce CV, une glissière règle la taille, un clic applique.
let tplStudio = null;
function closeTplStudio() {
  tplStudio?.remove();
  tplStudio = null;
}
function openTplStudio(id) {
  closeTplStudio();
  const items = pickerDocs(id);
  const doc = id === 'main' ? project : project.docs.find((d) => d.id === id);
  // Taille gardée d'une ouverture à l'autre ; la glissière ne fait que changer la taille
  // d'affichage (aucun nouveau rendu) : les aperçus sont dessinés une fois, en haute définition.
  let size = Number(read('salacv:tpl-size')) || 220;
  const picked = new Set();
  const grid = h('div', { class: 'tpl-studio-grid' });
  grid.style.setProperty('--tw', `${size}px`);
  const bar = h('div', { class: 'tpl-studio-bar', hidden: true });
  const renderBar = () => {
    bar.hidden = !picked.size;
    if (!picked.size) return;
    bar.replaceChildren(
      h('span', {}, `${picked.size} modèle${picked.size > 1 ? 's' : ''} sélectionné${picked.size > 1 ? 's' : ''}`),
      h('button', { type: 'button', class: 'btn-text', onClick: () => (picked.clear(), grid.querySelectorAll('.tpl-studio-item').forEach((el) => el.classList.remove('picked')), renderBar()) }, 'Annuler'),
      h('button', { type: 'button', class: 'btn-primary', onClick: () => createFromTemplates(doc, [...picked]) }, `Créer ${picked.size} conteneur${picked.size > 1 ? 's' : ''}`),
    );
  };
  grid.append(
    ...items.map((t) => {
      const c = h('canvas');
      if (t.doc) requestAnimationFrame(() => drawDoc(engine, c, t.doc, 420));
      const el = h(
        'div',
        { class: `tpl-studio-item${t.selected ? ' on' : ''}` },
        h('button', { type: 'button', class: 'tpl-studio-pick', onClick: () => (closeTplStudio(), pickTemplate(id, t.id)) }, c),
        // Sélection multiple (Pro) : un conteneur par modèle coché.
        workspace?.on &&
          h('button', {
            type: 'button',
            class: 'tpl-studio-check',
            'aria-label': `Sélectionner ${t.name}`,
            onClick: () => {
              picked.has(t.id) ? picked.delete(t.id) : picked.add(t.id);
              el.classList.toggle('picked', picked.has(t.id));
              renderBar();
            },
          }),
        h('span', {}, t.name, t.selected && h('em', {}, ' · actuel')),
      );
      return el;
    }),
  );
  const range = h('input', { type: 'range', min: 140, max: 420, step: 10, value: size, 'aria-label': 'Taille des aperçus' });
  range.addEventListener('input', () => {
    size = Number(range.value);
    grid.style.setProperty('--tw', `${size}px`);
    store('salacv:tpl-size', String(size));
  });
  tplStudio = h(
    'section',
    { class: 'tpl-studio', role: 'dialog', 'aria-label': 'Modèles' },
    h(
      'header',
      { class: 'tpl-studio-head' },
      h('div', {}, h('span', { class: 'ws-picker-kicker' }, workspace?.on ? 'Modèles · coche-en plusieurs pour créer des conteneurs' : 'Modèles'), h('strong', {}, docLabel(doc))),
      h('label', { class: 'tpl-studio-size' }, 'Taille', range),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onClick: closeTplStudio }, '✕'),
    ),
    grid,
    bar,
  );
  document.body.append(tplStudio);
}

// Un nouveau CV (conteneur) du projet par modèle choisi, copie du CV d'origine.
function createFromTemplates(from, ids) {
  saveCurrent();
  const src = from === curDoc() ? state : from.state;
  for (const tpl of ids) {
    const st = normalizeState(structuredClone(src));
    st.template = tpl;
    const variants = Object.fromEntries(Object.entries(from.variants ?? {}).map(([l, v]) => [l, { ...structuredClone(v), template: tpl }]));
    project.docs.push({ id: Math.random().toString(36).slice(2, 9), cvName: `${docLabel(from)} · ${TEMPLATES.find((t) => t.id === tpl)?.name}`, styled: true, state: st, variants });
  }
  saveProject(project);
  closeTplStudio();
  tplPickFor = null;
  wsRefresh();
  toast(`${ids.length} conteneur${ids.length > 1 ? 's' : ''} créé${ids.length > 1 ? 's' : ''} dans le projet.`);
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && tplStudio && closeTplStudio());

// Mises en page des modèles gardées tant que le CV ne change pas (pas de lag à chaque rendu).
let pickerCache = { key: '', items: [] };
function pickerDocs(id) {
  const key = `${id}|${JSON.stringify(id === activeDoc ? state : (id === 'main' ? project : project.docs.find((d) => d.id === id))?.state)}|${JSON.stringify(tplSettings)}|${isPro()}`;
  if (pickerCache.key === key) return pickerCache.items;
  pickerCache = { key, items: pickerDocsFresh(id) };
  return pickerCache.items;
}
function pickerDocsFresh(id) {
  const doc = id === 'main' ? project : project.docs.find((d) => d.id === id);
  const base = toResume(normalizeState(id === activeDoc ? state : doc.state), { mockup: example });
  const current = id === activeDoc ? state.template : doc.state.template;
  return TEMPLATES.filter((t) => templateVisible(t.id, current)).map((t) => {
    const r = layoutResume({ ...base, template: t.id }, engine.fonts);
    return { id: t.id, name: t.name, selected: t.id === current, doc: r.ok ? r.doc : null };
  });
}

// Sélecteur du CV actif dans le projet (en haut à gauche de l'espace).
let pickerOpen = false;
function renderPicker() {
  const el = $('ws-picker');
  el.hidden = !workspace?.on;
  if (el.hidden) return;
  const docs = [project, ...project.docs];
  const cur = curDoc();
  const button = h(
    'button',
    { type: 'button', class: 'ws-picker-btn', 'aria-expanded': String(pickerOpen), onClick: () => ((pickerOpen = !pickerOpen), renderPicker()) },
    h('span', { class: 'ws-picker-kicker' }, `Projet · ${docs.length} CV`),
    h('strong', {}, `${docLabel(cur)} · ${String(activeLang).toUpperCase()}`),
    h('span', { 'aria-hidden': 'true' }, pickerOpen ? '▴' : '▾'),
  );
  const list = pickerOpen
    ? h(
        'div',
        { class: 'ws-picker-list' },
        docs.map((d) => {
          const id = d === project ? 'main' : d.id;
          const langs = [d.state.lang, ...Object.keys(d.variants ?? {}).filter((l) => l !== d.state.lang)];
          return h(
            'div',
            { class: `ws-pick${id === activeDoc ? ' current' : ''}` },
            h('button', { type: 'button', class: 'ws-pick-name', title: 'Clic : aller à ce CV · double-clic : renommer', onClick: () => switchDoc(id, undefined, { focus: true }), onDblclick: (e) => renameDoc(d, e.currentTarget) }, docLabel(d)),
            h('button', { type: 'button', class: 'ws-pick-dup', title: 'Dupliquer ce CV', 'aria-label': `Dupliquer ${docLabel(d)}`, onClick: () => duplicateDoc(d) }, icon('copy', 15)),
            h('div', { class: 'ws-pick-langs' }, langs.map((l) => h('button', { type: 'button', class: `ws-lang${id === activeDoc && l === activeLang ? ' on' : ''}`, onClick: () => ((pickerOpen = false), switchDoc(id, l, { focus: true })) }, String(l).toUpperCase()))),
          );
        }),
        h('button', { type: 'button', class: 'ws-pick-add', onClick: () => ((pickerOpen = false), addDoc()) }, '+ Nouveau CV dans le projet'),
      )
    : null;
  el.replaceChildren(button, list ?? '');
}

// Double-clic sur un nom de CV : on le renomme sur place (Entrée valide, Échap annule).
function renameDoc(d, el) {
  const input = h('input', { class: 'ws-pick-rename', value: docLabel(d), maxlength: 60, 'aria-label': 'Nom du CV' });
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) {
      if (d === project) project.name = name;
      else Object.assign(d, { cvName: name, styled: true });
      saveProject(project);
      renderTitle();
    }
    renderPicker();
    if (workspace?.on) wsRefresh();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// Étapes en bouton flottant (bas droite) : un clic les déplie.
let fabOpen = false;
function renderStepFab() {
  const el = $('step-fab');
  el.hidden = !workspace?.on;
  if (el.hidden) return;
  const step = STEPS[stepIndex];
  el.replaceChildren(
    fabOpen
      ? h(
          'div',
          { class: 'step-fab-list' },
          STEPS.map((s, i) => h('button', { type: 'button', class: `step-fab-item${i === stepIndex ? ' on' : ''}`, onClick: () => ((fabOpen = false), goTo(i), renderStepFab()) }, h('span', {}, String(i + 1)), s.label)),
        )
      : '',
    h('button', { type: 'button', class: 'step-fab-btn', 'aria-expanded': String(fabOpen), onClick: () => ((fabOpen = !fabOpen), renderStepFab()) }, h('span', { class: 'step-fab-ring', style: `--p:${(stepIndex + 1) / STEPS.length}` }, String(stepIndex + 1)), h('span', {}, step.label), h('small', {}, `${stepIndex + 1}/${STEPS.length}`)),
  );
}

function setWorkspace(enabled) {
  if (!engine) return;
  workspace ??= createWorkspace({
    preview,
    canvases,
    engine,
    onZoom: (z) => ($('zoom-label').textContent = `${Math.round(z * 100)} %`),
    onTemplate: (id) => openTplStudio(id), // plus de modèles étalés sur la carte : un clic ouvre la grande fenêtre
    onPickTemplate: pickTemplate,
    onExpandTemplates: openTplStudio,
    cardEl: tplCardEl,
    onSwitch(key) {
      const [id, lang] = key.split(':');
      switchDoc(id, lang);
    },
    onLang: wsLang,
  });
  root.classList.toggle('pro', enabled);
  if (enabled) {
    workspace.enable();
    wsRefresh();
  } else {
    workspace.disable();
    canvases.replaceChildren();
    if (current) paint(current.doc);
    renderPicker();
    renderStepFab();
  }
  $('ws-toggle').setAttribute('aria-pressed', String(enabled));
  $('ws-toggle').replaceChildren({ lite: 'Lite', pro: 'Pro' }[enabled ? getPlan() : 'lite'], h('span', { class: 'pro-tag' }, 'MODE'));
}

$('ws-toggle').addEventListener('click', () => {
  openPlans();
});

// Lite (par défaut) ou Pro : le choix de la façon de travailler.
function openPlans() {
  const plans = [
    { id: 'lite', name: 'Lite', text: 'Un CV, vite fait. L’aperçu d’abord, on touche le CV pour le modifier.' },
    { id: 'pro', name: 'Pro', text: 'Tu édites toi-même : un projet contient plusieurs CV, chacun avec ses langues, dans un espace infini.' },
  ];
  const d = openDialog({
    title: 'Ta façon de travailler',
    className: 'plans-dialog',
    content: [
      h(
        'div',
        { class: 'plans' },
        plans.map((p) =>
          h(
            'button',
            {
              type: 'button',
              class: 'plan',
              'aria-pressed': String(getPlan() === p.id),
              onClick: () => {
                setPlan(p.id);
                d.close();
                setWorkspace(p.id !== 'lite');
                applyTplSettings();
                toast(p.id === 'lite' ? 'Mode Lite : un CV, l’aperçu d’abord.' : 'Mode Pro activé.');
              },
            },
            h('strong', {}, p.name, p.id !== 'lite' && h('span', { class: 'pro-tag' }, 'PRO')),
            h('span', {}, p.text),
          ),
        ),
      ),
      h('p', { class: 'hint' }, 'Pendant la phase d’essai, le mode Pro est gratuit.'),
    ],
  });
}

// --- Projet et export -----------------------------------------------------------

// /studio/?p=<id> ouvre un de SES CV ; le CV de quelqu'un d'autre seulement s'il est public (on en fait une copie).
// ?new (et ?name=, ?template=) en crée un : c'est l'entrée depuis la landing. Sinon le plus récent.
// Un visiteur passe toujours par la landing : lien privé, lien inconnu ou studio sans CV en cours → accueil.
async function openProject(ids = {}) {
  const q = new URLSearchParams(location.search);
  const raw = q.get('p');
  const pid = raw ? (ids[raw] ?? raw) : null;
  const logged = Boolean(getSession());
  const fresh = () => createProject({ name: (q.get('name') ?? '').trim().slice(0, 80), template: q.get('template') ?? undefined, persona: q.get('persona') ?? undefined });
  let p = null;
  if (pid) p = getProject(pid) ?? (await openShared(pid, logged));
  else if (q.has('new')) p = fresh();
  else p = listProjects()[0] ?? (logged || window.desktop?.isDesktop ? fresh() : null);
  if (!p) {
    location.replace(logged ? '/dashboard/' : '/');
    await new Promise(() => {}); // la page change
  }
  history.replaceState(null, '', `${location.pathname}?p=${p.id}`);
  return p;
}

// CV public de quelqu'un d'autre : on le montre, et il devient le tien en copie (l'original ne bouge jamais).
async function openShared(id, logged) {
  const cv = await fetchShared(id);
  if (!cv) return null;
  const name = projectName({ name: cv.name, state: normalizeState(cv.state) });
  return new Promise((resolve) => {
    let copy = null;
    const d = openDialog({
      title: 'CV partagé',
      content: [
        h('p', { class: 'dlg-text' }, h('strong', {}, name)),
        h('p', { class: 'dlg-text' }, logged ? 'Fais-en ta copie pour l’adapter : elle va dans tes CV, l’original ne change pas.' : 'Fais-en ta copie pour l’adapter : elle reste sur cet appareil jusqu’à ta connexion.'),
      ],
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, logged ? 'Mes CV' : 'Accueil'),
        h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => ((copy = createProject({ copy: cv })), d.close()) }, 'Dupliquer ce CV'),
      ],
      onClose: () => resolve(copy),
    });
  });
}

// Jamais de téléchargement direct : la préparation (progression, crédit) puis le fichier.
// Disponible à tout moment : la vérification conseille, elle ne bloque pas. Seul le nom
// est indispensable (le CV n'existe pas sans).
// Mode Pro : tous les CV du projet (et leurs langues) à exporter ensemble. Le CV en cours d'édition vient de l'état vivant.
function exportItems() {
  saveCurrent();
  const items = [];
  for (const d of [project, ...project.docs]) {
    const id = d === project ? 'main' : d.id;
    const versions = [[d.state.lang, d.state], ...Object.entries(d.variants ?? {}).filter(([l]) => l !== d.state.lang)];
    for (const [lang, st] of versions) {
      const live = id === activeDoc && lang === activeLang;
      items.push({ key: `${id}:${lang}`, label: docLabel(d), lang, state: normalizeState(live ? state : st) });
    }
  }
  return items;
}

function download() {
  // Pro avec plusieurs CV : une fenêtre pour choisir, CV par CV, les formats à préparer.
  if (workspace?.on) {
    const items = exportItems();
    if (items.length > 1) return openMultiExport({ items });
  }
  if (!state.profile.name.trim()) {
    toast('Écris d’abord ton nom : il est obligatoire sur le CV.');
    ctx.goToStep('identite');
    setSheet('expanded');
    return;
  }
  const missing = checklist(state, current?.doc).filter((c) => c.level !== 'ok');
  openExport({ state, missing, onReview: () => (goTo(STEPS.length - 1), setSheet('expanded')) });
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
