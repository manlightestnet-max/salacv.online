// Tableau de bord : mes CV enregistrés, l'explorateur de formats (gratuits et premium à
// venir) et la gestion des crédits. Les miniatures sont rendues par le vrai moteur.
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { drawDoc, loadEngine } from './lib/engine.js';
import { deleteProject, duplicateProject, inviteLink, listProjects, relativeDate, wallet, write } from './lib/store.js';
import { TEMPLATES, toResume } from './state.js';

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

$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  write('salacv:theme', root.dataset.theme);
});

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
function projectsView() {
  const projects = listProjects();
  const newCard = h('a', { class: 'card new-card', href: '/studio/?new' }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'), h('strong', {}, 'Nouveau CV'), h('small', {}, 'Commence de zéro'));
  const cards = projects.map((p) => {
    const name = p.state.profile.name.trim() || 'CV sans nom';
    const tpl = TEMPLATES.find((t) => t.id === p.state.template)?.name ?? '';
    const menu = h('div', { class: 'card-menu' });
    const card = h(
      'article',
      { class: 'card project' },
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
    h('div', { class: 'cards' }, newCard, cards),
  );
}

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
async function creditsView() {
  const { credits, weekly, nextReset, history } = await wallet.balance();
  const days = Math.max(0, Math.ceil((nextReset - Date.now()) / 86400000));
  const ratio = Math.min(1, credits / weekly);
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
    header('Crédits', 'Un crédit prépare un CV en PDF (et Word). Re-télécharger la même version est gratuit.'),
    h(
      'div',
      { class: 'credit-grid' },
      h(
        'div',
        { class: 'panel balance' },
        h(
          'div',
          { class: 'ring', style: `--r:${ratio}` },
          h('div', { class: 'ring-in' }, h('strong', {}, String(credits)), h('small', {}, `sur ${weekly}`)),
        ),
        h(
          'div',
          { class: 'balance-text' },
          h('strong', {}, credits ? `${credits} crédit${credits > 1 ? 's' : ''} disponible${credits > 1 ? 's' : ''}` : 'Plus de crédit cette semaine'),
          h('p', {}, `Recharge à ${weekly} crédits dimanche${days ? ` · dans ${days} jour${days > 1 ? 's' : ''}` : ''}.`),
          h('p', { class: 'mono' }, nextReset.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })),
        ),
      ),
      h(
        'div',
        { class: 'panel invite' },
        h('strong', {}, 'Invite tes amis'),
        h('p', {}, 'Chaque ami qui crée son CV avec ton lien vous rapporte des crédits bonus, à toi et à lui.'),
        h('code', { class: 'link' }, link.replace(/^https?:\/\//, '')),
        h('div', { class: 'row' }, h('a', { class: 'btn-primary', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'), copy),
      ),
      h(
        'div',
        { class: 'panel history' },
        h('strong', {}, 'Historique'),
        history.length
          ? h('ul', {}, history.map((x) => h('li', {}, h('span', {}, x.reason), h('span', { class: 'mono' }, relativeDate(x.at)), h('strong', { class: x.amount < 0 ? 'neg' : 'pos' }, `${x.amount > 0 ? '+' : ''}${x.amount}`))))
          : h('p', { class: 'empty' }, 'Aucune dépense pour l’instant.'),
      ),
    ),
  );
}

// --- Navigation --------------------------------------------------------------------
const VIEWS = { projets: projectsView, explorer: explorerView, credits: creditsView };

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
