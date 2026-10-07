// Tableau de bord : mes CV enregistrés, l'explorateur de formats (gratuits et premium à
// venir), la gestion des crédits et le compte (menu en haut à droite, page « Mon compte »). Les miniatures sont rendues par le vrai moteur.
import { openThemePicker } from './lib/theme.js';
import { readSession } from './login.js';
import { initSession, logout } from './session.js';
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { drawDoc, loadEngine } from './lib/engine.js';
import { ai, formatCredits, hasPending, initStore, deletePersona, deleteProject, duplicateProject, inviteLink, listPersonas, listProjects, projectName, relativeDate, savePersona, wallet } from './lib/store.js';
import { initPullRefresh } from './lib/pullrefresh.js';
import { openDialog } from './dialog.js';
import { followOrder, openShop, orderMessage, pendingOrder } from './buy.js';
import { trackWait } from './lib/progress.js';
import { openZoom } from './lib/zoomview.js';
import { offerSandboxSync } from './sync.js';
import { TEMPLATES, toResume } from './state.js';

// Le tableau de bord est réservé aux connectés : un visiteur est renvoyé vers la connexion (sur PC, une clé hors ligne active suffit).
async function gate() {
  if (readSession()) return true;
  if (window.desktop?.isDesktop) {
    const st = await window.desktop.license.status().catch(() => null);
    if (st?.state === 'active') return true;
    location.replace('/welcome/');
    return false;
  }
  location.replace('/auth/?next=/dashboard/');
  return false;
}
const $ = (id) => document.getElementById(id);
const view = $('view');
let engine = null;
// La page s'affiche tout de suite (titres, boutons, textes) ; seules les valeurs qui attendent le serveur scintillent.
// ready : session vérifiée et CV du compte chargés.
let ready = false;
const skel = (cls) => h('span', { class: `skel ${cls}`, 'aria-hidden': 'true' });

// --- Données gardées (cet appareil) ----------------------------------------------------------
// Solde, historique et IA : un onglet s'affiche aussitôt avec les dernières valeurs connues, puis se met à jour en
// arrière-plan ; il ne se redessine que si quelque chose a changé.
const CACHE_KEY = 'salacv:dash';
let cache = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    return {};
  }
})();
const saveCache = () => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
};
let offline = false;
let loadingCredits = null;
function loadCredits() {
  loadingCredits ??= Promise.all([wallet.balance(), ai.quota()])
    .then(([w, q]) => {
      offline = Boolean(w.offline);
      if (offline || !w.loggedIn) return false;
      const next = { wallet: { credits: w.credits, history: w.history }, ai: q.ok ? { quota: q.quota, resetCost: q.resetCost, packs: q.packs } : null };
      const changed = JSON.stringify(next) !== JSON.stringify({ wallet: cache.wallet, ai: cache.ai ?? null });
      cache = { ...cache, ...next, user: readSession()?.username };
      saveCache();
      setPill(w.credits);
      return changed;
    })
    .finally(() => (loadingCredits = null));
  return loadingCredits;
}
const currentTab = () => (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'projets');
const pending = []; // miniatures à peindre quand le moteur sera prêt

// Formats à venir : visibles dans l'explorateur, marqués Premium, pas encore utilisables.
const PREMIUM = [
  { id: 'chronos', name: 'Chronos', tags: ['Premium', 'Frise'], text: 'Une frise chronologique verticale pour les parcours riches.' },
  { id: 'atelier', name: 'Atelier', tags: ['Premium', 'Créatif'], text: 'Pour les métiers créatifs : grande photo, typographie affirmée.' },
  { id: 'monogramme', name: 'Monogramme', tags: ['Premium', 'Élégant'], text: 'Initiales en monogramme, sobre et haut de gamme.' },
  { id: 'ats', name: 'ATS', tags: ['Premium', 'Recruteurs'], text: 'Une colonne, lu sans erreur par les logiciels de recrutement.' },
];
const DESCRIPTIONS = {
  minimal: 'Une colonne, net et lisible.',
  bandeau: 'Bandeau de couleur et colonne latérale.',
  vitae: 'Classique, intitulés alignés à gauche.',
  diagonale: 'En-tête en diagonale, moderne.',
  epure: 'Beaucoup de blanc, très calme.',
  marine: 'Colonne bleu marine avec photo ronde.',
  contraste: 'Nom en capitales, bandeau noir.',
};

$('theme').addEventListener('click', () => openThemePicker());

// Peint (maintenant ou au chargement du moteur) le CV dans le canvas.
function thumb(resume, width) {
  const canvas = h('canvas', { class: 'paper pending', 'aria-hidden': 'true' });
  const paint = () => {
    const r = layoutResume(resume, engine.fonts);
    if (r.ok) drawDoc(engine, canvas, r.doc, width);
    canvas.classList.remove('pending');
  };
  if (engine) paint();
  else pending.push(paint);
  return canvas;
}

function header(title, sub, action) {
  return h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, title), sub && h('p', { class: 'sub' }, sub)), action);
}

// « Mes CV » réunit les CV et les profils (personnalités), chacun son onglet ; l'indicateur glisse de l'un à l'autre.
function hubTabs(active) {
  const nCv = listProjects().length;
  const nProfiles = listPersonas().length;
  const tab = (id, label, n) =>
    h('a', { class: 'hub-tab', href: `#${id}`, role: 'tab', 'aria-selected': String(active === id) }, label, h('span', { class: 'hub-count' }, ready ? String(n) : skel('skel-count')));
  return h(
    'nav',
    { class: `hub-tabs${active === 'personnalites' ? ' second' : ''}`, role: 'tablist', 'aria-label': 'Mes CV' },
    h('span', { class: 'hub-ink', 'aria-hidden': 'true' }),
    tab('projets', 'CV', nCv),
    tab('personnalites', 'Profils', nProfiles),
  );
}

// --- Nouveau CV : l'IA d'abord ---------------------------------------------------------
// Tout bouton « Nouveau CV » ouvre ce choix : importer l'ancien CV, ou commencer avec l'IA ; le formulaire reste possible.
function newCvSheet() {
  const tile = (cls, href, title, sub) => h('a', { class: `new-tile ${cls}`, href }, h('strong', {}, title), h('small', {}, sub), h('span', { class: 'new-tile-shine', 'aria-hidden': 'true' }));
  const d = openDialog({
    title: 'Nouveau CV',
    className: 'new-cv-sheet',
    content: [
      h('div', { class: 'new-tiles' }, tile('import', '/studio/?new&import', 'Importer mon CV', 'PDF ou photo : l’IA lit tout et remplit'), tile('ai', '/studio/?new&ai', 'Commencer avec l’IA', 'Raconte ton parcours, elle écrit ton CV')),
      h('a', { class: 'new-form-link', href: '/studio/?new&form' }, 'Remplir un formulaire vide'),
    ],
    footer: [h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler')],
  });
}
document.addEventListener('click', (e) => {
  const link = e.target.closest?.('[data-new-cv]');
  if (!link || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  newCvSheet();
});

// --- Mes CV ----------------------------------------------------------------------
// Recherche sans accents ni majuscules : « jose » trouve « José ».
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let query = '';

function projectsView() {
  const projects = listProjects();
  const newCard = h('a', { class: 'card new-card', href: '/studio/?new', 'data-new-cv': true }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'), h('strong', {}, 'Nouveau CV'), h('small', {}, 'Avec l’IA ou depuis ton ancien CV'));
  const cards = projects.map((p) => {
    const name = p.state.profile.name.trim() || 'CV sans nom';
    const tpl = TEMPLATES.find((t) => t.id === p.state.template)?.name ?? '';
    const menu = h('div', { class: 'card-menu' });
    const st = p.state;
    const haystack = fold([name, st.profile.title, st.profile.email, tpl, ...st.education.map((i) => `${i.title} ${i.org}`), ...st.experiences.map((i) => `${i.title} ${i.org}`), ...st.skills].join(' '));
    const card = h(
      'article',
      { class: 'card project', 'data-search': haystack },
      h('a', { class: 'card-link', href: `/studio/?p=${p.id}`, 'aria-label': `Ouvrir ${name}` }, h('div', { class: 'paper-wrap' }, thumb(toResume(p.state, { mockup: example }), 148))),
      h(
        'div',
        { class: 'card-info' },
        h('div', { class: 'card-text' }, h('strong', {}, name), h('small', {}, `${tpl} · ${relativeDate(p.updatedAt)}`)),
        h('button', { type: 'button', class: 'icon-btn more', 'aria-label': `Actions pour ${name}`, 'aria-expanded': 'false', onClick: (e) => toggleMenu(e.currentTarget, menu) }, '⋯'),
      ),
      menu,
    );
    menu.append(
      h('a', { href: `/studio/?p=${p.id}` }, 'Ouvrir'),
      h('button', { type: 'button', onClick: () => (duplicateProject(p.id), render()) }, 'Dupliquer'),
      h(
        'button',
        {
          type: 'button',
          class: 'danger',
          onClick: (e) => {
            // Deux appuis pour supprimer : pas de suppression par erreur.
            if (e.currentTarget.dataset.confirm) {
              deleteProject(p.id);
              card.classList.add('leaving');
              setTimeout(render, 220);
            } else {
              e.currentTarget.dataset.confirm = '1';
              e.currentTarget.textContent = 'Confirmer la suppression';
            }
          },
        },
        'Supprimer',
      ),
    );
    return card;
  });
  if (!ready) {
    return h(
      'section',
      {},
      header('Mes CV', skel('skel-line'), h('a', { class: 'btn-primary hide-mobile', href: '/studio/?new', 'data-new-cv': true }, 'Nouveau CV')),
      hubTabs('projets'),
      h('div', { class: 'cards' }, newCard, skel('skel-card'), skel('skel-card'), skel('skel-card')),
    );
  }
  return h(
    'section',
    {},
    header('Mes CV', projects.length ? `${projects.length} CV enregistré${projects.length > 1 ? 's' : ''}` : 'Tes CV apparaîtront ici.', h('a', { class: 'btn-primary hide-mobile', href: '/studio/?new', 'data-new-cv': true }, 'Nouveau CV')),
    hubTabs('projets'),
    projects.length > 0 && searchBox(),
    h('div', { class: 'cards' }, newCard, cards),
    h('p', { class: 'no-result', hidden: true }, 'Aucun CV ne correspond à ta recherche.'),
  );
}

// Filtre les cartes sur place (pas de nouveau rendu : le champ garde le focus).
function filterCards() {
  const words = fold(query).split(/\s+/).filter(Boolean);
  let shown = 0;
  document.querySelectorAll('.card.project').forEach((card) => {
    const ok = words.every((w) => card.dataset.search.includes(w));
    card.hidden = !ok;
    shown += ok;
  });
  document.querySelector('.new-card')?.toggleAttribute('hidden', Boolean(words.length));
  const empty = document.querySelector('.no-result');
  if (empty) empty.hidden = !words.length || shown > 0;
}

function searchBox() {
  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'Rechercher un CV : nom, poste, école…',
    'aria-label': 'Rechercher dans mes CV',
    enterkeyhint: 'search',
    value: query,
    onInput: (e) => ((query = e.target.value), filterCards()),
    onKeydown: (e) => e.key === 'Escape' && ((query = e.target.value = ''), filterCards()),
  });
  requestAnimationFrame(filterCards);
  return h('label', { class: 'search' }, h('span', { class: 'search-icon', 'aria-hidden': 'true' }), input, h('kbd', { class: 'search-key hide-mobile' }, '/'));
}

// « / » : aller à la recherche, comme sur les grands sites.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.target.closest?.('input, textarea')) return;
  const input = document.querySelector('.search-input');
  if (input) (e.preventDefault(), input.focus());
});

function toggleMenu(button, menu) {
  const open = !menu.classList.contains('open');
  document.querySelectorAll('.card-menu.open').forEach((m) => m.classList.remove('open'));
  document.querySelectorAll('.more[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  menu.classList.toggle('open', open);
  button.setAttribute('aria-expanded', String(open));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.card-menu, .more')) document.querySelectorAll('.card-menu.open').forEach((m) => m.classList.remove('open'));
});

// --- Explorer ---------------------------------------------------------------------
let filter = 'tous';
function explorerView() {
  const chips = ['tous', 'gratuits', 'premium'].map((f) =>
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === f), onClick: () => ((filter = f), render()) }, f[0].toUpperCase() + f.slice(1)),
  );
  // Toucher un modèle l'agrandit : la page entière, nette, redessinée par le moteur.
  const zoom = (t, from) => {
    if (!engine) return;
    const r = layoutResume({ ...example, template: t.id }, engine.fonts);
    if (!r.ok) return;
    openZoom({ engine, doc: r.doc, from, title: t.name, sub: DESCRIPTIONS[t.id] ?? '', actions: [h('a', { class: 'btn-primary', href: `/studio/?new&template=${t.id}` }, 'Utiliser ce modèle')] });
  };
  const free = TEMPLATES.map((t) =>
    h(
      'article',
      { class: 'card format' },
      h(
        'button',
        { type: 'button', class: 'paper-wrap zoomable', 'aria-label': `Agrandir le modèle ${t.name}`, onClick: (e) => zoom(t, e.currentTarget.querySelector('canvas')) },
        thumb({ ...example, template: t.id }, 172),
        h('span', { class: 'zoom-hint', 'aria-hidden': 'true' }, 'Agrandir'),
      ),
      h('div', { class: 'format-info' }, h('div', {}, h('strong', {}, t.name), h('span', { class: 'tag' }, 'Gratuit')), h('p', {}, DESCRIPTIONS[t.id] ?? '')),
      h('a', { class: 'btn-ghost', href: `/studio/?new&template=${t.id}` }, 'Utiliser ce modèle'),
    ),
  );
  const premium = PREMIUM.map((t) =>
    h(
      'article',
      { class: 'card format soon' },
      h('div', { class: 'paper-wrap' }, h('div', { class: 'paper soon-paper' }, h('span', { class: 'lock', 'aria-hidden': 'true' }), h('span', { class: 'mono' }, 'Bientôt'))),
      h('div', { class: 'format-info' }, h('div', {}, h('strong', {}, t.name), ...t.tags.map((g) => h('span', { class: g === 'Premium' ? 'tag premium' : 'tag' }, g))), h('p', {}, t.text)),
      h('button', { class: 'btn-ghost', type: 'button', disabled: true }, 'Bientôt disponible'),
    ),
  );
  return h(
    'section',
    {},
    header('Explorer', 'Les formats de CV, gratuits et premium. De nouveaux arrivent régulièrement.'),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer' }, chips),
    h('div', { class: 'cards formats' }, filter !== 'premium' && free, filter !== 'gratuits' && premium),
  );
}

// --- Crédits ----------------------------------------------------------------------
// Message après un retour de la page LightPay (?order=…), affiché une fois.
let flash = '';
const ORDER_PARAM = /^ord_[A-Za-z0-9_-]{16,40}$/;
// Dernier solde affiché sur la page Crédits : il compte depuis là quand le solde bouge (achat, dépense).
let shownBalance = null;

// Payé : le solde se met à jour partout, tout de suite (pastille du haut, anneau de la page Crédits).
function creditsArrived(order) {
  setPill(order.balance);
  if (cache.wallet) cache.wallet = { ...cache.wallet, credits: order.balance };
  if (currentTab() === 'credits') render({ quiet: true });
  loadCredits().then((changed) => changed && currentTab() === 'credits' && render({ quiet: true })); // l'historique suit
}

const openRecharge = () => openShop({ keyAccount: readSession()?.kind === 'key', onPaid: creditsArrived });

// Compte de `from` à `to` dans `el` (instantané si l'utilisateur limite les animations).
function countUp(el, from, to) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    const v = from + (to - from) * (1 - (1 - t) ** 3);
    el.textContent = formatCredits(Number.isInteger(to) && Number.isInteger(from) ? Math.round(v) : v);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function creditsView() {
  const notice = flash;
  flash = '';
  const w = cache.wallet;
  const known = Boolean(w);
  const credits = w?.credits ?? 0;
  // Première fois sur la page : le solde compte depuis zéro et l'anneau se remplit. Ensuite, rien ne bouge
  // tant que le solde ne change pas ; s'il change, il compte depuis l'ancien.
  const first = shownBalance === null;
  const from = first ? 0 : shownBalance;
  const moved = known && from !== credits;
  if (known) shownBalance = credits;
  const amount = h('strong', {}, known ? formatCredits(moved ? from : credits) : skel('skel-amount'));
  if (moved) requestAnimationFrame(() => countUp(amount, from, credits));
  const fill = credits > 0 ? Math.max(0.12, Math.min(1, credits / 10)) : 0;
  const recharge = h('button', { type: 'button', class: 'btn-primary recharge', onClick: openRecharge }, h('span', { class: 'coin', 'aria-hidden': 'true' }), 'Recharger');
  const link = inviteLink();
  const copy = h('button', { type: 'button', class: 'btn-ghost' }, 'Copier mon lien');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Lien copié';
    } catch {
      copy.textContent = link;
    }
  });
  const message = `Fais ton CV sur salacv en quelques minutes : ${link}`;
  const history = w?.history ?? [];
  return h(
    'section',
    { class: known && !moved ? 'settled' : '' },
    header('Crédits', 'Un crédit prépare un CV en PDF sans filigrane (et Word). Re-télécharger la même version est gratuit.'),
    offline && h('p', { class: 'empty' }, 'Impossible de joindre le serveur : le solde affiché peut être inexact.'),
    notice && h('p', { class: 'flash', role: 'status' }, notice),
    h(
      'div',
      { class: 'credit-grid' },
      h(
        'div',
        { class: 'panel balance' },
        h(
          'div',
          { class: `ring${moved && !first ? ' gained' : ''}${known ? '' : ' waiting'}`, style: `--target:${known ? Math.round(fill * 360) : 0}deg` },
          h('span', { class: 'orbit', 'aria-hidden': 'true' }, h('i', { class: 'coin' }), h('i', { class: 'coin' }), h('i', { class: 'coin' })),
          h('div', { class: 'ring-in' }, amount, h('small', {}, credits > 1 ? 'crédits' : 'crédit')),
        ),
        h(
          'div',
          { class: 'balance-text' },
          known ? h('strong', {}, credits ? `${formatCredits(credits)} crédit${credits > 1 ? 's' : ''} disponible${credits > 1 ? 's' : ''}` : 'Plus de crédit') : skel('skel-line wide'),
          h('p', {}, known && !credits ? 'Sans crédit, ton PDF sort avec filigrane.' : 'Un crédit par nouvelle version de ton CV.'),
          recharge,
        ),
      ),
      cache.ai ? aiPanel(cache.ai) : !known && aiPanelWaiting(),
      h(
        'div',
        { class: 'panel invite' },
        h('strong', {}, 'Parle de salacv à tes amis'),
        h('p', {}, 'Un CV propre, en quelques minutes.'),
        h('code', { class: 'link' }, link.replace(/^https?:\/\//, '')),
        h('div', { class: 'row' }, h('a', { class: 'btn-primary', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'), copy),
      ),
      h(
        'div',
        { class: 'panel history' },
        h('strong', {}, 'Historique'),
        !known
          ? h('ul', {}, [0, 1, 2].map(() => h('li', {}, skel('skel-line'), skel('skel-line short'), skel('skel-line short'))))
          : history.length
            ? h('ul', {}, history.map((x, i) => h('li', { style: `--i:${i}` }, h('span', {}, x.reason), h('span', { class: 'mono' }, relativeDate(x.at)), h('strong', { class: x.amount < 0 ? 'neg' : 'pos' }, `${x.amount > 0 ? '+' : ''}${formatCredits(x.amount)}`))))
            : h('p', { class: 'empty' }, 'Aucune opération pour l’instant.'),
      ),
    ),
  );
}

// Le panneau de l'IA tant que sa réserve n'est pas connue : sa forme, la jauge scintille.
function aiPanelWaiting() {
  return h(
    'div',
    { class: 'panel ai-panel' },
    h('div', { class: 'ai-top' }, h('strong', {}, 'Assistant IA'), skel('skel-line short')),
    skel('skel-gauge'),
    h('p', {}, 'Elle se vide à chaque échange avec l’assistant et ne se recharge pas seule.'),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn-primary', disabled: true }, 'Réinitialiser la progression')),
  );
}

// --- IA du compte ------------------------------------------------------------------------
// La réserve se vide à chaque échange avec l'assistant et ne se recharge pas seule : on la remet à zéro (prix fixé
// dans l'admin, 0,5 crédit) ou on prend un pack IA (créés par l'admin). Pas assez de crédits : la recharge s'ouvre,
// et l'achat se termine tout seul dès que le paiement est confirmé.
const tokensFr = (n) => `${Number(n).toLocaleString('fr-FR')} tokens`;
const creditsFr = (n) => `${formatCredits(n)} crédit${n > 1 ? 's' : ''}`;

function aiPanel({ quota, resetCost, packs }) {
  const left = Math.max(0, 100 - quota.percent);
  const status = h('p', { class: 'ai-status', role: 'status' });
  const run = (button, action, done) => async () => {
    button.disabled = true;
    status.textContent = '';
    const r = await action();
    button.disabled = false;
    if (r.ok) return finished(r, done);
    if (r.code !== 'NO_CREDIT') return (status.textContent = r.error || 'Impossible pour l’instant. Réessaie.');
    openShop({
      keyAccount: readSession()?.kind === 'key',
      note: `${r.error} Recharge : ${done.toLowerCase()} dès que le paiement est confirmé.`,
      onPaid: async (order) => {
        setPill(order.balance);
        const again = await action();
        if (again.ok) return finished(again, done);
        flash = again.error || 'Crédits ajoutés, mais l’achat n’a pas abouti : réessaie depuis Crédits.';
        render({ quiet: true });
      },
    });
  };
  const finished = (r, done) => {
    setPill(r.balance);
    publishAi(r.quota);
    if (cache.wallet) cache.wallet = { ...cache.wallet, credits: r.balance };
    if (cache.ai) cache.ai = { ...cache.ai, quota: r.quota };
    flash = done;
    render({ quiet: true });
    loadCredits().then((changed) => changed && currentTab() === 'credits' && render({ quiet: true }));
  };
  const reset = h('button', { type: 'button', class: 'btn-primary', disabled: quota.percent === 0 || null }, `Réinitialiser la progression · ${creditsFr(resetCost)}`);
  reset.addEventListener('click', run(reset, ai.reset, 'Ton IA est remise à zéro.'));
  const tiles = packs.map((p) => {
    const take = h('button', { type: 'button', class: 'btn-ghost' }, creditsFr(p.credits));
    take.addEventListener('click', run(take, () => ai.buy(p.id), `${p.name} ajouté à ton IA.`));
    return h('li', { class: 'ai-pack' }, h('div', {}, h('strong', {}, p.name), h('small', {}, `${tokensFr(p.tokens)} · ${p.days ? `${p.days} jours` : 'sans limite de temps'}`)), take);
  });
  return h(
    'div',
    { class: 'panel ai-panel' },
    h('div', { class: 'ai-top' }, h('strong', {}, 'Assistant IA'), h('span', { class: 'mono' }, quota.exhausted ? 'vide' : `${left} % restant`)),
    h('div', { class: `ai-gauge${left <= 20 ? ' low' : ''}${quota.exhausted ? ' out' : ''}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(left), 'aria-label': 'Réserve de l’IA' }, h('span', { style: `--left:${left}%` })),
    h('p', {}, quota.exhausted ? 'Ta réserve est vide : remets-la à zéro ou prends un pack pour continuer avec l’assistant.' : 'Elle se vide à chaque échange avec l’assistant et ne se recharge pas seule.'),
    h('div', { class: 'row' }, reset),
    tiles.length > 0 && h('ul', { class: 'ai-packs' }, tiles),
    status,
  );
}

// Le studio (barre de l'IA) se met à jour s'il est ouvert dans un autre onglet.
const publishAi = (quota) => {
  try {
    if (quota) localStorage.setItem('salacv:ai-quota', JSON.stringify({ ...quota, at: Date.now() }));
  } catch {}
};

// --- Navigation --------------------------------------------------------------------
// --- Personnalités --------------------------------------------------------------------
// Tes informations de base, gardées une fois : un nouveau CV part d'elles et tu changes
// seulement la profession (technicien ici, médecin là).
function personasView() {
  if (!ready) {
    return h('section', {}, header('Mes CV', 'Tes profils : tes informations gardées une fois, pour démarrer un CV sans rien retaper.'), hubTabs('personnalites'), h('div', { class: 'personas' }, skel('skel-panel'), skel('skel-panel')));
  }
  const personas = listPersonas();
  const projects = listProjects();
  const count = (st) => {
    const n = (list) => list.filter((i) => (i.title ?? i.name ?? i).toString().trim()).length;
    return [`${n(st.education)} formation${n(st.education) > 1 ? 's' : ''}`, `${n(st.experiences)} expérience${n(st.experiences) > 1 ? 's' : ''}`, `${st.skills.length} compétences`, `${n(st.languages)} langues`].join(' · ');
  };
  const rename = (p) => {
    const input = h('input', { class: 'search-input dlg-input', value: p.name, maxlength: 60, 'aria-label': 'Nom' });
    const d = openDialog({
      title: 'Renommer la personnalité',
      content: input,
      footer: [h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'), h('button', { type: 'button', class: 'btn-primary', onClick: () => (savePersona({ ...p, name: input.value }), d.close(), render()) }, 'Enregistrer')],
    });
  };
  const fromCv = () => {
    const d = openDialog({
      title: 'Créer depuis un CV',
      content: [
        h('p', { class: 'dlg-text' }, 'Choisis le CV dont tu veux garder les informations.'),
        h('div', { class: 'dlg-list' }, projects.map((p) => h('button', { type: 'button', class: 'dlg-item', onClick: () => (savePersona({ name: p.state.profile.name, state: p.state }), d.close(), render()) }, h('strong', {}, projectName(p)), h('small', {}, count(p.state))))),
      ],
      footer: [h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler')],
    });
  };
  const cards = personas.map((p) =>
    h(
      'article',
      { class: 'panel persona' },
      h('div', { class: 'persona-head' }, h('span', { class: 'persona-mark', 'aria-hidden': 'true' }, (p.name[0] ?? '?').toUpperCase()), h('div', {}, h('strong', {}, p.name), h('small', {}, count(p.state)))),
      h('p', {}, `Mise à jour ${relativeDate(p.updatedAt)}. Un nouveau CV reprend tout ; tu choisis seulement la profession.`),
      h(
        'div',
        { class: 'row' },
        h('a', { class: 'btn-primary', href: `/studio/?new&persona=${p.id}` }, 'Nouveau CV'),
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => rename(p) }, 'Renommer'),
        h('button', { type: 'button', class: 'btn-ghost danger', onClick: () => (deletePersona(p.id), render()) }, 'Supprimer'),
      ),
    ),
  );
  return h(
    'section',
    {},
    header('Mes CV', 'Tes profils : tes informations gardées une fois, pour démarrer un CV sans rien retaper.', projects.length > 0 && h('button', { type: 'button', class: 'btn-primary', onClick: fromCv }, 'Créer depuis un CV')),
    hubTabs('personnalites'),
    personas.length
      ? h('div', { class: 'personas' }, cards)
      : h(
          'div',
          { class: 'panel persona-empty' },
          h('strong', {}, 'Aucune personnalité pour l’instant'),
          h('p', {}, projects.length ? 'Garde les informations d’un de tes CV : identité, formation, expériences, langues… Ensuite, chaque nouveau CV part de là.' : 'Fais d’abord un CV, puis garde ses informations ici.'),
          projects.length ? h('button', { type: 'button', class: 'btn-primary', onClick: fromCv }, 'Créer depuis un CV') : h('a', { class: 'btn-primary', href: '/studio/?new' }, 'Faire mon premier CV'),
        ),
  );
}

// --- Compte ------------------------------------------------------------------------------
const pc = window.desktop?.isDesktop ? window.desktop : null;
const dateFr = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const initials = (s) => {
  const parts = String(s.name || s.username || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
};
// Photo Google si on l'a, sinon les initiales (aussi si l'image ne charge pas).
function avatar(session, size) {
  const letters = h('span', { class: 'avatar', style: `--s:${size}px`, 'aria-hidden': 'true' }, session ? initials(session) : '?');
  if (!session?.picture) return letters;
  const img = h('img', { class: 'avatar', style: `--s:${size}px`, src: session.picture, alt: '', referrerpolicy: 'no-referrer', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(letters));
  return img;
}
const accountLabel = (s) => (s.kind === 'key' ? 'Clé en ligne' : 'Compte Google');
const displayName = (s) => s.name || (s.kind === 'key' ? 'Compte avec clé' : s.username.replace(/@.*/, ''));

async function signOut(button) {
  if (button) {
    button.disabled = true;
    button.textContent = 'Déconnexion…';
  }
  await logout();
  location.replace(pc ? '/welcome/' : '/');
}

// Bouton en haut à droite : avatar → menu (identité, Mon compte, thème, déconnexion).
function accountMenu() {
  const session = readSession();
  const root = $('account');
  const trigger = h('button', { type: 'button', class: 'account-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': session ? `Mon compte : ${displayName(session)}` : 'Compte' }, avatar(session, 30));
  const close = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const item = (label, attrs) => h(attrs.href ? 'a' : 'button', { class: 'menu-item', role: 'menuitem', ...(attrs.href ? {} : { type: 'button' }), ...attrs }, label);
  const menu = h(
    'div',
    { class: 'account-menu', role: 'menu', hidden: true },
    session
      ? h('div', { class: 'menu-who' }, avatar(session, 38), h('div', {}, h('strong', {}, displayName(session)), h('small', {}, session.kind === 'key' ? accountLabel(session) : session.username)))
      : h('div', { class: 'menu-who' }, avatar(null, 38), h('div', {}, h('strong', {}, 'Pas connecté'), h('small', {}, pc ? 'Clé hors ligne active sur ce PC' : 'Visiteur'))),
    h('div', { class: 'menu-sep' }),
    item('Mon compte', { href: '#compte', onClick: () => close() }),
    item('Mes CV', { href: '#projets', onClick: () => close() }),
    item('Crédits', { href: '#credits', onClick: () => close() }),
    item('Thème', { onClick: () => (close(), openThemePicker()) }),
    h('div', { class: 'menu-sep' }),
    session
      ? item('Se déconnecter', { class: 'menu-item danger', onClick: (e) => signOut(e.currentTarget) })
      : item('Se connecter', { href: pc ? '/welcome/' : '/auth/?next=/dashboard/' }),
  );
  const open = () => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('.menu-item')?.focus();
  };
  trigger.addEventListener('click', () => (menu.hidden ? open() : close()));
  document.addEventListener('pointerdown', (e) => !root.contains(e.target) && close());
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      trigger.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('.menu-item')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  root.replaceChildren(trigger, menu);
}

function accountView() {
  const session = readSession();
  if (!ready) {
    return h(
      'section',
      { class: 'account-page' },
      header('Mon compte', 'Ton profil, ton espace et ta session.'),
      h('div', { class: 'panel profile' }, skel('skel-avatar'), h('div', { class: 'profile-text' }, skel('skel-line wide'), skel('skel-line'))),
      h('div', { class: 'stats' }, ['CV', 'profils', 'crédits'].map((label) => h('div', { class: 'stat' }, h('strong', {}, skel('skel-amount')), h('span', {}, label)))),
    );
  }
  if (!session) {
    return h(
      'section',
      {},
      header('Mon compte', 'Tu utilises salacv avec une clé hors ligne sur ce PC.'),
      h(
        'div',
        { class: 'panel' },
        h('strong', {}, 'Pas de compte connecté'),
        h('p', {}, 'Connecte-toi avec Google ou une clé en ligne pour retrouver tes CV partout, tes crédits et l’assistant.'),
        h('div', { class: 'row' }, h('a', { class: 'btn-primary', href: pc ? '/welcome/' : '/auth/?next=/dashboard/' }, 'Se connecter')),
      ),
    );
  }
  const credits = cache.wallet?.credits;
  const stat = (value, label, href) => h('a', { class: 'stat', href }, h('strong', {}, value ?? skel('skel-amount')), h('span', {}, label));
  const nCv = listProjects().length;
  const nPersonas = listPersonas().length;
  const logoutBtn = h('button', { type: 'button', class: 'btn-ghost danger' }, 'Se déconnecter');
  logoutBtn.addEventListener('click', () => signOut(logoutBtn));
  const facts = [
    session.since && ['Membre depuis', dateFr(session.since)],
    session.lastLogin && ['Dernière connexion', relativeDate(session.lastLogin)],
    session.logins > 0 && ['Connexions', String(session.logins)],
    ['Type de compte', accountLabel(session)],
  ].filter(Boolean);
  return h(
    'section',
    { class: 'account-page' },
    header('Mon compte', 'Ton profil, ton espace et ta session.'),
    h(
      'div',
      { class: 'panel profile' },
      avatar(session, 64),
      h('div', { class: 'profile-text' }, h('strong', {}, displayName(session)), session.kind !== 'key' && h('span', {}, session.username), h('span', { class: 'badge' }, accountLabel(session))),
    ),
    h(
      'div',
      { class: 'stats' },
      stat(String(nCv), nCv > 1 ? 'CV enregistrés' : 'CV enregistré', '#projets'),
      stat(String(nPersonas), nPersonas > 1 ? 'personnalités' : 'personnalité', '#personnalites'),
      stat(credits == null ? null : formatCredits(credits), credits > 1 ? 'crédits' : 'crédit', '#credits'),
    ),
    h('div', { class: 'panel' }, h('strong', {}, 'Détails'), h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))))),
    h(
      'div',
      { class: 'panel' },
      h('strong', {}, 'Tes données'),
      h('p', {}, 'Tes CV et tes personnalités sont enregistrés sur ton compte salacv, pas dans ce navigateur : tu les retrouves sur n’importe quel appareil en te connectant.'),
      session.kind !== 'key' && h('p', {}, 'Ton nom et ta photo viennent de ton compte Google ; salacv ne voit jamais ton mot de passe.'),
    ),
    h(
      'div',
      { class: 'panel session' },
      h('strong', {}, 'Session'),
      h('p', {}, pc ? 'Tu es connecté dans l’app salacv sur ce PC.' : 'Tu es connecté dans ce navigateur. La session dure 7 jours, puis on te redemande de te connecter.'),
      h('div', { class: 'row' }, logoutBtn, h('button', { type: 'button', class: 'btn-ghost', onClick: () => openThemePicker() }, 'Changer de thème')),
    ),
  );
}

const VIEWS = { projets: projectsView, personnalites: personasView, explorer: explorerView, credits: creditsView, compte: accountView };

const visited = new Set();
let renderId = 0;
// quiet : mise à jour sur place (données arrivées, retour sur l'app) : ni animation, le contenu change là où il est.
function render({ quiet = false } = {}) {
  const id = ++renderId;
  const tab = currentTab();
  // « Profils » vit sous « Mes CV » : c'est l'onglet Mes CV qui s'allume.
  const navTab = tab === 'personnalites' ? 'projets' : tab;
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === navTab)));
  const scroll = window.scrollY;
  view.replaceChildren(VIEWS[tab]());
  if (quiet) window.scrollTo({ top: scroll });
  // Un onglet déjà vu revient tel quel, sans rejouer d'entrée (pas d'effet « rechargement »).
  if (!quiet && !visited.has(tab)) {
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
  } else view.classList.remove('enter');
  if (ready) visited.add(tab);
  if (!ready || quiet) return;
  // En arrière-plan : solde, historique et IA relus ; la page ne bouge que s'ils ont changé.
  loadCredits().then((changed) => changed && id === renderId && ['credits', 'compte'].includes(currentTab()) && render({ quiet: true }));
}

// Pastille du haut : le solde (au dixième) ; la valeur exacte est gardée à part pour comparer.
function setPill(balance) {
  const el = $('credit-count');
  if (balance == null) return;
  const before = el.dataset.v === undefined ? NaN : Number(el.dataset.v);
  el.dataset.v = String(balance);
  el.textContent = formatCredits(balance);
  if (Number.isFinite(before) && before !== balance) {
    const pill = $('credit-pill');
    pill.classList.remove('bump');
    void pill.offsetWidth;
    pill.classList.add('bump');
  }
}

// --- Démarrage -------------------------------------------------------------------------------------
// 1. La page tout de suite (dernières valeurs connues, le reste scintille). 2. Session et CV du compte.
// 3. La page complète, sur place.
if (cache.wallet) setPill(cache.wallet.credits);
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo({ top: 0 });
});
render();

await initSession();
if (!(await gate())) await new Promise(() => {}); // la page change : on n'affiche rien
if (cache.user && cache.user !== readSession()?.username) {
  cache = {}; // un autre compte sur cet appareil : on ne montre pas ses chiffres
  saveCache();
  $('credit-count').replaceChildren(skel('skel-num'));
  delete $('credit-count').dataset.v;
}
accountMenu();
await initStore(); // les CV et personnalités du compte, depuis le serveur
ready = true;
// Seuls les onglets qui dépendent du compte se complètent (Crédits et Explorer sont déjà justes : rien ne s'interrompt).
if (['projets', 'personnalites', 'compte'].includes(currentTab())) render({ quiet: true });
else visited.add(currentTab());
loadCredits().then((changed) => changed && ['credits', 'compte'].includes(currentTab()) && render({ quiet: true }));
offerSandboxSync(); // des CV faits sans compte sur cet appareil ? on propose de les ajouter au compte

// Retour de la page LightPay (?order=…) : on suit le paiement, puis le solde monte ou un message s'affiche.
const back = new URLSearchParams(location.search).get('order');
if (back) {
  window.history.replaceState(null, '', `${location.pathname}${location.hash}`);
  if (ORDER_PARAM.test(back)) {
    trackWait(followOrder(back, { maxMs: 15_000 })).then((order) => {
      if (order.status === 'PAID') return creditsArrived(order);
      flash = orderMessage(order);
      if (currentTab() === 'credits') render({ quiet: true });
    });
  }
}
// Un paiement laissé en cours (feuille fermée, page rechargée) : on continue à le suivre en arrière-plan.
const leftOver = pendingOrder();
if (leftOver && !back) followOrder(leftOver).then((order) => order.status === 'PAID' && creditsArrived(order));

// Toujours à jour : en revenant sur l'app (autre onglet, studio, page de paiement, retour arrière), la liste et le
// solde sont relus sur le serveur et la page redessinée. Jamais par-dessus des modifications pas encore envoyées.
let lastSync = Date.now();
async function resync({ force = false } = {}) {
  if (hasPending() || (!force && Date.now() - lastSync < 4000)) return;
  lastSync = Date.now();
  const sig = () => JSON.stringify([listProjects().map((p) => [p.id, p.updatedAt]), listPersonas().map((p) => [p.id, p.updatedAt])]);
  const before = sig();
  await initStore();
  if (sig() !== before) render({ quiet: true });
  const changed = await loadCredits();
  if (changed && ['credits', 'compte'].includes(currentTab())) render({ quiet: true });
}
window.addEventListener('pageshow', (e) => e.persisted && resync({ force: true }));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resync());
window.addEventListener('focus', () => resync());
// Appli installée : pas de « tirer pour actualiser » natif, on le fait nous-mêmes.
initPullRefresh(() => resync({ force: true }));

loadEngine()
  .then((e) => {
    engine = e;
    pending.splice(0).forEach((paint) => paint());
  })
  .catch((err) => console.error(err));
