// Landing : le CV d'exemple change de style tout seul et le nom tapé y apparaît en direct (vrai moteur, celui du
// studio). Tout le reste vient du serveur : chiffres, prix des crédits, cadeau d'inscription, avis. Une tuile ou
// une section dont la donnée n'existe pas reste cachée : rien n'est inventé.
import { openThemePicker } from './lib/theme.js';
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { drawDoc, loadEngine } from './lib/engine.js';
import { h } from './dom.js';
import { TEMPLATES } from './state.js';
import { readSession } from './login.js';
import { initSession } from './session.js';

const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CYCLE_MS = 2600;
const nf = (n) => Number(n).toLocaleString('fr-FR');
const post = (route) => fetch(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());

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
const reveal = (root = document) =>
  root.querySelectorAll('.reveal:not(.in)').forEach((el, i) => {
    el.style.setProperty('--d', `${(i % 4) * 70}ms`);
    io.observe(el);
  });
reveal();

// Bouton flottant (mobile) dès que le héros est passé.
new IntersectionObserver(([e]) => $('dock').classList.toggle('show', !e.isIntersecting), { threshold: 0.15 }).observe($('haut'));

// Compte jusqu'au chiffre quand la tuile apparaît (instantané si l'utilisateur limite les animations).
function countUp(el, to, format = nf) {
  if (reduced) return void (el.textContent = format(to));
  const ob = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    ob.disconnect();
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 1100);
      el.textContent = format(to * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  ob.observe(el);
}

// --- Héros : CV vivant ------------------------------------------------------------
const stage = $('stage');
const nameInput = $('name');
let engine = null;
let active = 0;
let timer = null;
const papers = TEMPLATES.map((t, i) => ({ ...t, canvas: h('canvas', { class: 'paper', 'data-active': String(i === 0), 'aria-hidden': String(i !== 0) }) }));
const dots = papers.map((p, i) =>
  h('button', { type: 'button', class: 'dot', 'aria-label': p.name, 'aria-pressed': String(i === 0), onClick: () => (show(i), restart()) }),
);
$('stage-dots').replaceChildren(...dots);
$('tpl-count').textContent = String(TEMPLATES.length);

const resumeFor = (template) => {
  const name = nameInput.value.trim();
  return { ...example, template, profile: { ...example.profile, ...(name ? { name } : {}) } };
};

function renderHero() {
  if (!engine) return;
  const w = Math.round(stage.clientWidth);
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
  if (!reduced) timer = setInterval(() => !document.hidden && nameInput !== document.activeElement && show(active + 1), CYCLE_MS);
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
    stage.style.setProperty('--rx', `${(-((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(2)}deg`);
    stage.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(2)}deg`);
  });
  wrap.addEventListener('pointerleave', () => {
    stage.style.setProperty('--rx', '0deg');
    stage.style.setProperty('--ry', '0deg');
  });
}

// --- Ruban des modèles (les vrais, puis les futurs formats premium) -------------------
const SOON = ['Chronos', 'Atelier', 'Monogramme'];
function renderMarquee() {
  const card = (paper, name, tag) => h('figure', { class: 'm-card' }, paper, h('figcaption', {}, h('span', {}, name), tag && h('span', { class: 'tag-premium' }, tag)));
  const canvas = document.createElement('canvas');
  const cards = [];
  for (const t of TEMPLATES) {
    const r = layoutResume({ ...example, template: t.id }, engine.fonts);
    if (!r.ok) continue;
    drawDoc(engine, canvas, r.doc, 150);
    cards.push(card(h('img', { class: 'm-paper', src: canvas.toDataURL('image/png'), alt: '' }), t.name, null));
  }
  for (const name of SOON) cards.push(card(h('div', { class: 'm-paper m-soon' }, h('span', {}, 'Bientôt')), name, 'Premium'));
  // Deux fois la même suite : la boucle infinie ne saute jamais.
  const copies = cards.map((c) => {
    const copy = c.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    return copy;
  });
  $('marquee-track').replaceChildren(...cards, ...copies);
}

// Le héros commence sur le modèle choisi dans l'admin (« nos cartes ») ; les autres défilent ensuite.
let firstTemplate = 0;
const configReady = post('config')
  .then((r) => {
    const i = papers.findIndex((p) => p.id === r.config?.['studio.defaultTemplate']);
    if (i > 0) firstTemplate = i;
  })
  .catch(() => {});

Promise.all([loadEngine(), configReady])
  .then(([e]) => {
    engine = e;
    stage.querySelector('.paper-skeleton')?.remove();
    stage.append(...papers.map((p) => p.canvas));
    renderHero();
    show(firstTemplate);
    restart();
    renderMarquee();
  })
  .catch((err) => {
    console.error(err);
    stage.classList.add('failed');
  });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderHero, 150);
});

// --- Connecté ? Les liens mènent à l'espace au lieu de la connexion. ---------------------
initSession().then(() => {
  if (!readSession()) return;
  document.querySelectorAll('[data-logged]').forEach((a) => {
    (a.querySelector('[data-label]') ?? a).textContent = a.dataset.logged;
    a.href = a.dataset.loggedHref || '/dashboard/';
  });
});

// --- Chiffres, cadeau et avis (serveur) -----------------------------------------------------
const ago = (ms) => {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return 'aujourd’hui';
  if (days < 7) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (days < 31) return `il y a ${Math.floor(days / 7)} semaine${days >= 14 ? 's' : ''}`;
  return new Date(ms).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

post('stats')
  .then((s) => {
    if (!s.ok) return;
    // Tuiles : seulement les chiffres qui existent.
    const tiles = [];
    const tile = (value, label, format) => {
      const strong = h('strong', {}, '0');
      tiles.push(h('div', { class: 'num-tile', style: `--i:${tiles.length}` }, strong, h('span', {}, label)));
      countUp(strong, value, format);
    };
    if (s.cvs > 0) tile(s.cvs, `CV préparé${s.cvs > 1 ? 's' : ''} avec salacv`);
    if (s.cvsWeek > 0) tile(s.cvsWeek, 'cette semaine');
    if (s.rating) tile(s.rating.average, `note moyenne · ${nf(s.rating.count)} avis`, (v) => `${v.toFixed(1).replace('.', ',')} ★`);
    tile(TEMPLATES.length, 'modèles pro');
    $('numbers').replaceChildren(...tiles);

    // Pastilles en direct sous le héros.
    const live = [];
    if (s.cvsWeek > 0) live.push(h('li', {}, h('span', { class: 'pulse', 'aria-hidden': 'true' }), h('strong', {}, nf(s.cvsWeek)), ` CV cette semaine`));
    if (s.rating) live.push(h('li', {}, '★ ', h('strong', {}, String(s.rating.average).replace('.', ',')), ` · ${nf(s.rating.count)} avis`));
    if (s.signupCredits > 0) live.push(h('li', {}, '🎁 ', h('strong', {}, String(s.signupCredits)), ` crédit${s.signupCredits > 1 ? 's' : ''} offert${s.signupCredits > 1 ? 's' : ''} à l’inscription`));
    if (live.length) {
      live.forEach((li, i) => li.style.setProperty('--i', String(i)));
      $('live').replaceChildren(...live);
      $('live').hidden = false;
      $('live').classList.add('in');
    }

    if (s.signupCredits > 0) {
      $('gift').textContent = `🎁 ${s.signupCredits} crédit${s.signupCredits > 1 ? 's' : ''} offert${s.signupCredits > 1 ? 's' : ''} à ta première connexion avec Google.`;
      $('gift').hidden = false;
    }

    // Avis : de vraies personnes, sans nom ni coordonnées (filtrés par le serveur).
    if (s.reviews?.length) {
      if (s.rating) $('rating-title').textContent = `${String(s.rating.average).replace('.', ',')} ★ sur ${nf(s.rating.count)} avis.`;
      $('review-grid').replaceChildren(
        ...s.reviews.map((r) =>
          h('figure', { class: 'review reveal' }, h('span', { class: 'review-stars', 'aria-label': `${r.stars} sur 5` }, '★'.repeat(r.stars)), h('p', {}, `« ${r.comment} »`), h('small', {}, `Utilisateur salacv · ${ago(r.at)}`)),
        ),
      );
      $('avis').hidden = false;
      reveal($('avis'));
    }
  })
  .catch(() => {});

// --- Prix : les packs réglés dans l'admin --------------------------------------------------
post('shop')
  .then((r) => {
    if (!r.ok || !r.packs?.length) return;
    const price = (p) => p.promoPrice ?? p.price;
    const each = (p) => price(p) / p.credits;
    const packs = [...r.packs].sort((a, b) => a.credits - b.credits);
    const cheapest = packs.reduce((a, b) => (each(b) < each(a) ? b : a));
    const best = packs.some((p) => each(p) > each(cheapest)) ? cheapest.id : null;
    const tiles = packs.slice(0, 3).map((p) => {
      const off = p.promoPrice ? Math.round((1 - p.promoPrice / p.price) * 100) : 0;
      return h(
        'article',
        { class: `price-tile reveal${p.id === best ? ' best' : ''}` },
        p.id === best ? h('span', { class: 'price-flag' }, 'Meilleur prix') : off > 0 && h('span', { class: 'price-flag promo' }, `−${off} %`),
        h('span', { class: 'price-amount' }, h('span', { class: 'coin', 'aria-hidden': 'true' }), String(p.credits)),
        h('span', { class: 'price-unit' }, p.credits > 1 ? 'crédits' : 'crédit'),
        h('strong', {}, `${nf(price(p))} FCFA`),
        p.promoPrice && h('s', {}, `${nf(p.price)} FCFA`),
        h('span', { class: 'price-each' }, `${nf(Math.round(each(p)))} FCFA / CV`),
      );
    });
    $('price-grid').append(...tiles);
    reveal($('prix'));
  })
  .catch(() => {});
