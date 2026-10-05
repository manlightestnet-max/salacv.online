// Landing : le CV d'exemple change de style tout seul, le nom tapé par le visiteur y
// apparaît en direct ; au défilement, le formulaire devient un CV. Rendu avec le vrai
// moteur (le même que le studio), donc ce que l'on voit est ce que l'on obtient.
import { openThemePicker } from './lib/theme.js';
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { drawDoc, loadEngine } from './lib/engine.js';
import { captureReferral } from './lib/store.js';
import { h } from './dom.js';
import { TEMPLATES } from './state.js';
import { readSession } from './login.js';

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CYCLE_MS = 2600;

captureReferral();

$('theme').addEventListener('click', () => openThemePicker());

// --- Apparitions au défilement ----------------------------------------------------
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
);
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.setProperty('--d', `${(i % 5) * 70}ms`);
  io.observe(el);
});

// Bouton flottant (mobile) dès que le héros est passé.
new IntersectionObserver(([e]) => $('dock').classList.toggle('show', !e.isIntersecting), { threshold: 0.15 }).observe($('haut'));

// --- Héros : CV vivant ------------------------------------------------------------
const stage = $('stage');
const nameInput = $('name');
let engine = null;
let active = 0;
let timer = null;
const papers = TEMPLATES.map((t, i) => {
  const canvas = h('canvas', { class: 'paper', 'data-active': String(i === 0), 'aria-hidden': String(i !== 0) });
  return { ...t, canvas };
});
const dots = papers.map((p, i) =>
  h('button', { type: 'button', class: 'dot', 'aria-label': p.name, 'aria-pressed': String(i === 0), onClick: () => (show(i), restart()) }),
);
$('stage-dots').replaceChildren(...dots);

function resumeFor(template) {
  const name = nameInput.value.trim();
  return { ...example, template, profile: { ...example.profile, ...(name ? { name } : {}) } };
}

function stageWidth() {
  return Math.round(stage.clientWidth);
}

function renderHero() {
  if (!engine) return;
  const w = stageWidth();
  for (const p of papers) {
    const r = layoutResume(resumeFor(p.id), engine.fonts);
    if (r.ok) drawDoc(engine, p.canvas, r.doc, w);
  }
}

function show(i) {
  active = (i + papers.length) % papers.length;
  papers.forEach((p, k) => {
    p.canvas.dataset.active = String(k === active);
    p.canvas.setAttribute('aria-hidden', String(k !== active));
  });
  dots.forEach((d, k) => d.setAttribute('aria-pressed', String(k === active)));
  $('stage-name').textContent = papers[active].name;
}

function restart() {
  clearInterval(timer);
  if (!reduced) timer = setInterval(() => !document.hidden && show(active + 1), CYCLE_MS);
}

let typing;
nameInput.addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(renderHero, 60);
  stage.classList.add('typing');
  clearTimeout(stage._t);
  stage._t = setTimeout(() => stage.classList.remove('typing'), 700);
});

// Entrée : direct au studio, avec son nom et le style affiché.
$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = new URLSearchParams({ new: '', template: papers[active].id });
  const name = nameInput.value.trim();
  if (name) q.set('name', name);
  location.href = `/studio/?${q}`.replace('new=&', 'new&');
});

// Inclinaison légère qui suit la souris (PC).
if (!reduced && window.matchMedia('(hover: hover)').matches) {
  const wrap = stage.parentElement;
  wrap.addEventListener('pointermove', (e) => {
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    stage.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
    stage.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
  });
  wrap.addEventListener('pointerleave', () => {
    stage.style.setProperty('--rx', '0deg');
    stage.style.setProperty('--ry', '0deg');
  });
}

// --- Histoire au défilement : formulaire → CV → PDF ------------------------------
const story = document.querySelector('.story');
const storyCv = $('story-cv');
const frame = document.querySelector('.story-frame');
const steps = [...document.querySelectorAll('.story-step')];
let storyTemplate = -1;

function onScroll() {
  const r = story.getBoundingClientRect();
  const total = r.height - window.innerHeight;
  const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
  const step = Math.min(2, Math.floor(p * 3));
  frame.style.setProperty('--p', p.toFixed(3));
  // Étape 1 : le CV se « construit » du haut vers le bas par-dessus le formulaire.
  frame.style.setProperty('--build', Math.min(1, p * 3).toFixed(3));
  frame.dataset.step = String(step);
  $('story-bar').style.width = `${p * 100}%`;
  steps.forEach((s, i) => s.classList.toggle('current', i === step));
  // Étape 2 : le style change au fil du défilement.
  const t = step === 1 ? Math.min(TEMPLATES.length - 1, Math.floor((p * 3 - 1) * TEMPLATES.length)) : step === 0 ? 0 : 5;
  if (engine && t !== storyTemplate) {
    storyTemplate = t;
    const res = layoutResume({ ...example, template: TEMPLATES[t].id }, engine.fonts);
    if (res.ok) drawDoc(engine, storyCv, res.doc, Math.round(frame.clientWidth));
  }
}
let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => ((ticking = false), onScroll()));
  },
  { passive: true },
);

// --- Ruban des modèles --------------------------------------------------------------
// Les 7 modèles, puis les futurs formats premium (à venir, verrouillés).
const SOON = ['Chronos', 'Atelier', 'Monogramme'];
function renderMarquee() {
  const card = (canvas, name, tag) => h('figure', { class: 'm-card' }, canvas, h('figcaption', {}, h('span', {}, name), tag && h('span', { class: 'tag-premium' }, tag)));
  const cards = [];
  for (const t of TEMPLATES) {
    const c = h('canvas', { class: 'm-paper' });
    const r = layoutResume({ ...example, template: t.id }, engine.fonts);
    if (r.ok) drawDoc(engine, c, r.doc, 150);
    cards.push(card(c, t.name, null));
  }
  for (const name of SOON) cards.push(card(h('div', { class: 'm-paper m-soon' }, h('span', { class: 'mono' }, 'Bientôt')), name, 'Premium'));
  // Deux fois la même suite : la boucle infinie ne saute jamais.
  const track = $('marquee-track');
  const clone = (el) => {
    const copy = el.cloneNode(true);
    const src = el.querySelector('canvas');
    if (src) copy.querySelector('canvas').replaceWith(Object.assign(document.createElement('img'), { src: src.toDataURL('image/png'), className: 'm-paper', alt: '' }));
    copy.setAttribute('aria-hidden', 'true');
    return copy;
  };
  track.replaceChildren(...cards, ...cards.map(clone));
}

// --- Chargement du moteur ------------------------------------------------------------
loadEngine()
  .then((e) => {
    engine = e;
    stage.querySelector('.paper-skeleton')?.remove();
    stage.append(...papers.map((p) => p.canvas));
    renderHero();
    show(0);
    restart();
    onScroll();
    renderMarquee();
  })
  .catch((err) => {
    console.error(err);
    stage.classList.add('failed');
  });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderHero();
    storyTemplate = -1;
    onScroll();
  }, 150);
});

// Liens selon la connexion : visiteur → « Connecte-toi » (le tableau de bord lui est fermé) ; connecté → « Mes CV ».
if (readSession()) {
  document.querySelectorAll('[data-logged]').forEach((a) => {
    a.textContent = a.dataset.logged;
    a.href = '/dashboard/';
  });
}
