// Tableau de bord : mes CV enregistrés, l'explorateur de formats (gratuits et premium à
// venir), la gestion des crédits et le compte (menu en haut à droite, page « Mon compte »). Les miniatures sont rendues par le vrai moteur.
import { openThemePicker } from './lib/theme.js';
import { readSession } from './login.js';
import { initSession, logout } from './session.js';
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { drawDoc, loadEngine } from './lib/engine.js';
import { initStore, deletePersona, deleteProject, duplicateProject, inviteLink, listPersonas, listProjects, projectName, relativeDate, savePersona, wallet } from './lib/store.js';
import { openDialog } from './dialog.js';
import { followOrder, openShop, orderMessage, pendingOrder } from './buy.js';
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
await initSession();
if (!(await gate())) await new Promise(() => {}); // la page change : on n'affiche rien
await initStore(); // les CV et personnalités du compte, depuis le serveur
await offerSandboxSync(); // des CV faits sans compte sur cet appareil ? on propose de les ajouter au compte

const $ = (id) => document.getElementById(id);
const view = $('view');
let engine = null;
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
  const canvas = h('canvas', { class: 'paper', 'aria-hidden': 'true' });
  const paint = () => {
    const r = layoutResume(resume, engine.fonts);
    if (r.ok) drawDoc(engine, canvas, r.doc, width);
  };
  if (engine) requestAnimationFrame(paint);
  else pending.push(paint);
  return canvas;
}

function header(title, sub, action) {
  return h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, title), sub && h('p', { class: 'sub' }, sub)), action);
}

// --- Mes CV ----------------------------------------------------------------------
// Recherche sans accents ni majuscules : « jose » trouve « José ».
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let query = '';

function projectsView() {
  const projects = listProjects();
  const newCard = h('a', { class: 'card new-card', href: '/studio/?new' }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'), h('strong', {}, 'Nouveau CV'), h('small', {}, 'Commence de zéro'));
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
  return h(
    'section',
    {},
    header('Mes CV', projects.length ? `${projects.length} CV enregistré${projects.length > 1 ? 's' : ''} sur cet appareil` : 'Tes CV apparaîtront ici.', h('a', { class: 'btn-primary hide-mobile', href: '/studio/?new' }, 'Nouveau CV')),
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
  const free = TEMPLATES.map((t) =>
    h(
      'article',
      { class: 'card format' },
      h('div', { class: 'paper-wrap' }, thumb({ ...example, template: t.id }, 172)),
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
// Crédits tout juste achetés : le solde monte sous les yeux au prochain affichage.
let gained = 0;

// Payé : le solde se met à jour partout, tout de suite (pastille du haut, anneau de la page Crédits).
function creditsArrived(order) {
  $('credit-count').textContent = String(order.balance ?? '');
  gained = order.credits;
  if (location.hash === '#credits') render();
}

const openRecharge = () => openShop({ keyAccount: readSession()?.kind === 'key', onPaid: creditsArrived });

// Compte de `from` à `to` dans `el` (instantané si l'utilisateur limite les animations).
function countUp(el, from, to) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function creditsView() {
  const back = new URLSearchParams(location.search).get('order');
  if (back) {
    window.history.replaceState(null, '', `${location.pathname}${location.hash}`);
    if (ORDER_PARAM.test(back)) {
      const order = await followOrder(back, { maxMs: 15_000 });
      if (order.status === 'PAID') gained = order.credits;
      else flash = orderMessage(order);
    }
  }
  const notice = flash;
  flash = '';
  const { credits, history, offline } = await wallet.balance();
  const gain = gained;
  gained = 0;
  const amount = h('strong', {}, String(gain ? credits - gain : credits));
  if (gain) requestAnimationFrame(() => countUp(amount, credits - gain, credits));
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
  return h(
    'section',
    {},
    header('Crédits', 'Un crédit prépare un CV en PDF sans filigrane (et Word). Re-télécharger la même version est gratuit.'),
    offline && h('p', { class: 'empty' }, 'Impossible de joindre le serveur : le solde affiché peut être inexact.'),
    notice && h('p', { class: 'flash', role: 'status' }, notice),
    h(
      'div',
      { class: 'credit-grid' },
      h(
        'div',
        { class: 'panel balance' },
        h('div', { class: `ring${gain ? ' gained' : ''}`, style: `--r:${credits > 0 ? 1 : 0}` }, h('div', { class: 'ring-in' }, amount, h('small', {}, credits > 1 ? 'crédits' : 'crédit'))),
        h(
          'div',
          { class: 'balance-text' },
          h('strong', {}, credits ? `${credits} crédit${credits > 1 ? 's' : ''} disponible${credits > 1 ? 's' : ''}` : 'Plus de crédit'),
          h('p', {}, credits ? 'Un crédit par nouvelle version de ton CV.' : 'Sans crédit, ton PDF sort avec filigrane.'),
          recharge,
        ),
      ),
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
        history.length
          ? h('ul', {}, history.map((x) => h('li', {}, h('span', {}, x.reason), h('span', { class: 'mono' }, relativeDate(x.at)), h('strong', { class: x.amount < 0 ? 'neg' : 'pos' }, `${x.amount > 0 ? '+' : ''}${x.amount}`))))
          : h('p', { class: 'empty' }, 'Aucune opération pour l’instant.'),
      ),
    ),
  );
}

// --- Navigation --------------------------------------------------------------------
// --- Personnalités --------------------------------------------------------------------
// Tes informations de base, gardées une fois : un nouveau CV part d'elles et tu changes
// seulement la profession (technicien ici, médecin là).
function personasView() {
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
    header('Personnalités', 'Tes informations, gardées une fois. Technicien dans un CV, médecin dans un autre : tu ne retapes rien.', projects.length > 0 && h('button', { type: 'button', class: 'btn-primary', onClick: fromCv }, 'Créer depuis un CV')),
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

async function accountView() {
  const session = readSession();
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
  const { credits } = await wallet.balance();
  const stat = (value, label, href) => h('a', { class: 'stat', href }, h('strong', {}, String(value)), h('span', {}, label));
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
      stat(nCv, nCv > 1 ? 'CV enregistrés' : 'CV enregistré', '#projets'),
      stat(nPersonas, nPersonas > 1 ? 'personnalités' : 'personnalité', '#personnalites'),
      stat(credits, credits > 1 ? 'crédits' : 'crédit', '#credits'),
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

async function render() {
  const tab = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'projets';
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  const content = await VIEWS[tab]();
  view.replaceChildren(content);
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  refreshCredits();
}

async function refreshCredits() {
  $('credit-count').textContent = String((await wallet.balance()).credits);
}

// Un paiement laissé en cours (feuille fermée, page rechargée) : on continue à le suivre en arrière-plan.
const leftOver = pendingOrder();
if (leftOver && !new URLSearchParams(location.search).get('order')) {
  followOrder(leftOver).then((order) => order.status === 'PAID' && creditsArrived(order));
}

accountMenu();
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo({ top: 0 });
});
render();

loadEngine()
  .then((e) => {
    engine = e;
    pending.splice(0).forEach((paint) => paint());
  })
  .catch((err) => console.error(err));
