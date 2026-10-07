// Admin salacv : utilisateurs (blocage), CV de la phase d'essai, ressources (JSON de la
// recherche web) et skills de l'agent. Même design que le tableau de bord.
import { layoutResume } from '../src/index.js';
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { drawDoc, loadEngine } from './lib/engine.js';
import { openThemePicker } from './lib/theme.js';
import { relativeDate } from './lib/store.js';
import { TEMPLATES, normalizeState, toResume } from './state.js';
import example from '../examples/etudiant.json';
import { registerTemplate } from '../src/templates/index.js';
import { parseTemplateSpec, templateFromSpec } from '../src/templates/spec.js';
import SKILL from '../skills/salacv-modele-cv/SKILL.md?raw';
import CANVAS_EXAMPLE from '../docs/exemples/canvas-bandeau.json';

const $ = (id) => document.getElementById(id);
const view = $('view');
// Connecté ? Le serveur le sait par un cookie httpOnly (8 h) : aucun jeton dans la page.
let token = false;

$('theme').addEventListener('click', () => openThemePicker());
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  token = false;
  render();
});

async function api(action, body = {}) {
  let res;
  try {
    res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    return { ok: false, error: 'Pas de connexion au serveur.' };
  }
  const data = await res.json().catch(() => ({ ok: false, error: `Réponse inattendue (HTTP ${res.status}).` }));
  if (res.status === 401 && action !== 'login') {
    token = false;
    render();
  }
  return data;
}

// Page au format Salacope : fil d'Ariane, titre, puis les cartes.
const page = (title, sub, action, ...body) =>
  h(
    'div',
    {},
    h('div', { class: 'ad-head' }, h('div', { class: 'ad-head-inner' }, h('p', { class: 'crumbs' }, h('span', {}, 'Administration'), h('span', { 'aria-hidden': 'true' }, '›'), h('span', {}, title)), h('div', { class: 'ad-title' }, h('h1', {}, title), action), sub && h('p', { class: 'ad-sub' }, sub))),
    h('div', { class: 'ad-body' }, ...body),
  );
const card = (title, extra, ...children) => h('section', { class: 'card-sec' }, h('header', {}, h('h2', {}, title), extra), ...children);
const statCell = (k, v, sub, accent) => h('div', { class: 'stat-cell' }, h('span', { class: 'k' }, k), h('strong', { class: `v${accent ? ' accent' : ''}` }, String(v)), sub && (typeof sub === 'string' ? h('span', { class: 's' }, sub) : sub));
const rowsOf = (items, empty) => h('div', { class: 'rows' }, items.length ? items : h('p', { class: 'rows-empty' }, empty));
const dateTime = (ts) => new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const notice = (text, kind = '') => h('p', { class: `admin-notice ${kind}` }, text);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Connexion -------------------------------------------------------------------------
function loginView() {
  const params = new URLSearchParams(location.search);
  const error = h('p', { class: 'admin-error', 'aria-live': 'polite' });
  if (params.get('denied')) error.textContent = 'Ce compte Google n’est pas administrateur.';
  const google = h('button', { class: 'btn-primary', type: 'button', onClick: () => (location.href = '/auth/?admin=1') }, 'Se connecter avec Google');
  return h(
    'section',
    { class: 'admin-center' },
    h('div', { class: 'panel admin-login' }, h('strong', {}, 'Administration'), h('p', {}, 'Accès réservé : connecte-toi avec le compte Google de l’administrateur. Le serveur compare l’identifiant Firebase du compte à celui qu’il garde secret.'), error, google),
  );
}

// --- Aperçu -----------------------------------------------------------------------------
let lastOverview = null;
async function overviewView() {
  const o = await api('overview');
  if (!o.ok) return page('Aperçu', null, null, notice(o.error, 'error'));
  lastOverview = o;
  syncBadge();
  const setup = await api('setup');
  const setupCard = setup.ok && card(
    'Configuration',
    h('span', { class: setup.checks.every((c) => c.ok || c.optional) ? 'tag' : 'tag danger' }, setup.checks.every((c) => c.ok || c.optional) ? 'Tout est prêt' : 'À compléter'),
    rowsOf(setup.checks.map((c) => h('div', { class: `row-item${c.ok || c.optional ? '' : ' blocked'}` }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, c.ok ? '✓' : c.optional ? '–' : '!'), h('div', { class: 'row-main' }, h('strong', {}, c.label, c.optional && h('span', { class: 'tag' }, 'facultatif')), h('small', {}, c.detail))), ), ''),
  );
  const res = o.resources ? Object.values(o.resources).reduce((a, b) => a + b, 0) : 0;
  const journal = o.journal.map(journalRow);
  return page(
    'Aperçu',
    null,
    null,
    setupCard,
    !o.durable && notice('Stockage temporaire : sur Vercel, ajoute UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN pour garder les données. Sur le VPS, tout est gardé dans data/.', 'warn'),
    card(
      'Utilisateurs et comptes',
      null,
      h(
        'div',
        { class: 'stat-grid' },
        statCell('Utilisateurs', o.users, h('a', { class: 's', href: '#utilisateurs' }, 'Voir la liste →')),
        statCell('Actifs', o.active7, 'sur les 7 derniers jours'),
        statCell('Nouveaux', o.new7, 'cette semaine'),
        statCell('Mesures', o.blocked, `${o.blocked} compte${o.blocked > 1 ? 's' : ''} bloqué${o.blocked > 1 ? 's' : ''}`),
      ),
    ),
    card(
      'Activité',
      null,
      h(
        'div',
        { class: 'stat-grid' },
        statCell('CV générés', o.cvs, h('a', { class: 's', href: '#cv' }, 'Phase d’essai →')),
        statCell('Aujourd’hui', o.cvsToday, `${o.cvs7} sur 7 jours`),
        statCell('Ressources', res, o.resources ? `${o.resources.metiers} métiers · ${o.resources.etablissements} établissements` : 'À importer', false),
        statCell('Skills ajoutées', o.skills, 'en plus de celles du code', true),
      ),
    ),
    card('Dernières actions', h('a', { href: '#journal' }, 'Tout le journal'), rowsOf(journal, 'Aucune action pour l’instant.')),
  );
}

function journalRow(e) {
  return h('div', { class: 'row-item' }, h('div', { class: 'row-main' }, h('strong', {}, e.title), e.detail && h('small', {}, e.detail)), h('span', { class: 'row-meta' }, dateTime(e.at)));
}

async function journalView() {
  const r = await api('journal');
  if (!r.ok) return page('Journal', null, null, notice(r.error, 'error'));
  return page('Journal', 'Toutes les actions faites depuis l’administration, la plus récente en premier.', null, card(`${r.journal.length} action${r.journal.length > 1 ? 's' : ''}`, null, rowsOf(r.journal.map(journalRow), 'Le journal est vide.')));
}

function syncBadge() {
  const b = document.getElementById('badge-blocked');
  b.hidden = !lastOverview?.blocked;
  b.textContent = String(lastOverview?.blocked ?? '');
}

// --- Utilisateurs ------------------------------------------------------------------------
async function usersView() {
  const r = await api('users');
  if (!r.ok) return page('Utilisateurs', null, null, notice(r.error, 'error'));
  async function setBlocked(u, blocked, reason) {
    const res = await api(blocked ? 'block' : 'unblock', { username: u.username, reason });
    if (res.ok) render();
  }
  function confirmBlock(u) {
    const reason = h('input', { class: 'admin-input', placeholder: 'Raison (facultatif, visible ici seulement)' });
    const d = openDialog({
      title: `Bloquer ${u.username} ?`,
      content: [h('p', { class: 'dialog-text' }, 'Il ne pourra plus se connecter ni utiliser l’assistant et la traduction.'), reason],
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn-primary danger-fill', onClick: () => (d.close(), setBlocked(u, true, reason.value)) }, 'Bloquer'),
      ],
    });
  }
  const base = Number(r.userTokens) || 0;
  const aiUse = (u) => {
    const used = u.ai?.used ?? 0;
    const limit = u.ai?.limit ?? base;
    return `${tokens(used)} / ${tokens(limit)}${u.ai?.custom != null ? ' (plafond à part)' : ''}`;
  };
  function aiDialog(u) {
    const limit = h('input', { class: 'admin-input', type: 'number', min: 0, step: 1000, inputmode: 'numeric', value: u.ai?.custom ?? '', placeholder: `Réglage général (${tokens(base)})`, 'aria-label': 'Plafond du compte' });
    const gift = h('input', { class: 'admin-input', type: 'number', min: 0, step: 1000, inputmode: 'numeric', placeholder: '0', 'aria-label': 'Tokens offerts' });
    const reset = h('input', { type: 'checkbox', 'aria-label': 'Remettre à zéro' });
    const error = h('p', { class: 'admin-notice error', hidden: true });
    const save = async () => {
      const res = await api('setUserAi', { username: u.username, reset: reset.checked, customLimit: limit.value.trim(), addTokens: gift.value.trim() ? Number(gift.value) : undefined });
      if (!res.ok) return ((error.hidden = false), (error.textContent = res.error));
      d.close();
      render();
    };
    const d = openDialog({
      title: `IA de ${u.username}`,
      content: [
        h('p', { class: 'dialog-text' }, `Utilisé : ${aiUse(u)}.`),
        h('label', { class: 'ad-check' }, reset, h('span', {}, 'Remettre sa progression à zéro')),
        h('label', { class: 'ad-label' }, 'Plafond de ce compte (tokens, vide = réglage général)', limit),
        h('label', { class: 'ad-label' }, 'Tokens offerts (ajoutés à sa réserve)', gift),
        error,
      ],
      footer: [h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'), h('button', { type: 'button', class: 'btn-primary', onClick: save }, 'Enregistrer')],
    });
  }
  async function setAi(u, allowed) {
    const res = await api('setAi', { username: u.username, allowed });
    if (res.ok) render();
  }
  const rows = r.users.map((u) =>
    h(
      'div',
      { class: `row-item${u.blocked ? ' blocked' : ''}` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.username[0].toUpperCase()),
      h(
        'div',
        { class: 'row-main' },
        h('strong', {}, u.username, u.blocked && h('span', { class: 'tag danger' }, 'Bloqué'), !u.aiAccess && h('span', { class: 'tag danger' }, 'IA retirée')),
        h('small', {}, `${u.logins} connexion${u.logins > 1 ? 's' : ''} · depuis le ${new Date(u.first).toLocaleDateString('fr-FR')} · IA ${aiUse(u)}${u.reason ? ` · ${u.reason}` : ''}`),
      ),
      h('span', { class: 'row-meta' }, u.last ? relativeDate(u.last) : '—'),
      h('button', { type: 'button', class: 'btn-ghost', title: 'Réserve d’IA de ce compte : remise à zéro, plafond, tokens offerts', onClick: () => aiDialog(u) }, 'Réglages IA'),
      h('button', { type: 'button', class: 'btn-ghost', title: u.aiAccess ? 'Retirer l’accès à l’assistant et à la traduction' : 'Rendre l’accès à l’assistant', onClick: () => setAi(u, !u.aiAccess) }, u.aiAccess ? 'Retirer l’IA' : 'Rendre l’IA'),
      h('button', { type: 'button', class: u.blocked ? 'btn-ghost' : 'btn-ghost danger-btn', onClick: () => (u.blocked ? setBlocked(u, false) : confirmBlock(u)) }, u.blocked ? 'Débloquer' : 'Bloquer'),
    ),
  );
  return page(
    'Utilisateurs',
    'Comptes connectés à l’assistant. Bloquer coupe l’accès à l’assistant et à la traduction.',
    null,
    card(`${r.users.length} compte${r.users.length > 1 ? 's' : ''}`, null, rowsOf(rows, 'Aucun utilisateur pour l’instant. Ils apparaissent à leur première connexion à l’assistant.')),
  );
}

const tokens = (n) => `${Number(n).toLocaleString('fr-FR')}`;

// --- IA des comptes ------------------------------------------------------------------------
// La réserve de chaque compte (aucune recharge automatique), le prix de la remise à zéro et les packs IA en crédits.
async function aiView() {
  const r = await api('ai');
  if (!r.ok) return page('IA des comptes', null, null, notice(r.error, 'error'));
  const setting = (key) => r.settings.find((s) => s.key === key);
  const fail = (text) => {
    const d = openDialog({ title: 'Impossible', content: h('p', { class: 'dialog-text' }, text), footer: [h('button', { type: 'button', class: 'btn-primary', onClick: () => d.close() }, 'OK')] });
  };
  const userTokens = h('input', { class: 'admin-input', type: 'number', min: 0, step: 1000, inputmode: 'numeric', value: setting('ai.userTokens').value, 'aria-label': 'Réserve de tokens' });
  const resetCost = h('input', { class: 'admin-input', type: 'text', inputmode: 'decimal', value: String(setting('ai.resetCost').value).replace('.', ','), 'aria-label': 'Prix de la remise à zéro' });
  const saveRules = h('button', { type: 'button', class: 'btn-primary' }, 'Enregistrer');
  saveRules.addEventListener('click', async () => {
    saveRules.disabled = true;
    for (const [key, value] of [['ai.userTokens', userTokens.value.trim()], ['ai.resetCost', resetCost.value.trim().replace(',', '.')]]) {
      const res = await api('setSetting', { key, value });
      if (!res.ok) return ((saveRules.disabled = false), fail(res.error));
    }
    render();
  });
  const rulesCard = card(
    'Réserve des comptes',
    null,
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Chaque compte connecté a cette réserve de tokens pour l’assistant. Elle ne se recharge jamais seule : le client la remet à zéro contre des crédits, ou prend un pack IA.'),
      h('label', { class: 'ad-label' }, 'Réserve de tokens par compte', userTokens),
      h('label', { class: 'ad-label' }, 'Prix de la remise à zéro (crédits, ex. 0,5)', resetCost),
      saveRules,
    ),
  );

  // Packs IA : aucun au départ ; une ligne par pack, enregistrés d'un coup.
  const list = h('div', { class: 'pack-rows' });
  const lines = [];
  function addLine(p = { id: '', name: '', tokens: '', credits: '', days: null, active: true }) {
    const line = {
      id: p.id,
      name: h('input', { class: 'admin-input', value: p.name, maxlength: 40, placeholder: 'MegaIA Push', 'aria-label': 'Nom' }),
      tokens: h('input', { class: 'admin-input', type: 'number', min: 1000, step: 1000, inputmode: 'numeric', value: p.tokens, 'aria-label': 'Tokens' }),
      credits: h('input', { class: 'admin-input', type: 'text', inputmode: 'decimal', value: p.credits === '' ? '' : String(p.credits).replace('.', ','), placeholder: '5', 'aria-label': 'Prix en crédits' }),
      days: h('input', { class: 'admin-input', type: 'number', min: 1, max: 366, step: 1, inputmode: 'numeric', value: p.days ?? '', placeholder: 'Sans limite', 'aria-label': 'Durée en jours' }),
      active: h('input', { type: 'checkbox', checked: p.active || null, 'aria-label': 'En vente' }),
    };
    const remove = h('button', { type: 'button', class: 'btn-ghost danger-btn' }, 'Retirer');
    const el = h(
      'div',
      { class: 'pack-row ai-row' },
      h('label', { class: 'ad-label' }, 'Nom', line.name),
      h('label', { class: 'ad-label' }, 'Tokens', line.tokens),
      h('label', { class: 'ad-label' }, 'Crédits', line.credits),
      h('label', { class: 'ad-label' }, 'Durée (jours)', line.days),
      h('label', { class: 'ad-check' }, line.active, h('span', {}, 'En vente')),
      remove,
    );
    remove.addEventListener('click', () => {
      lines.splice(lines.indexOf(line), 1);
      el.remove();
    });
    lines.push(line);
    list.append(el);
  }
  r.aiPacks.forEach(addLine);
  const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'pack';
  const save = h('button', { type: 'button', class: 'btn-primary' }, 'Enregistrer les packs IA');
  save.addEventListener('click', async () => {
    const used = new Set(lines.map((l) => l.id).filter(Boolean));
    const packs = lines.map((l) => {
      let id = l.id;
      if (!id) {
        id = slug(l.name.value);
        for (let n = 2; used.has(id); n++) id = `${slug(l.name.value)}-${n}`;
        used.add(id);
      }
      return { id, name: l.name.value, tokens: Number.parseInt(l.tokens.value, 10), credits: l.credits.value.trim().replace(',', '.'), days: l.days.value.trim(), active: l.active.checked };
    });
    save.disabled = true;
    const res = await api('saveAiPacks', { packs });
    save.disabled = false;
    res.ok ? render() : fail(res.error);
  });
  const packsCard = card(
    'Packs IA',
    h('button', { type: 'button', class: 'btn-ghost', onClick: () => addLine() }, 'Ajouter un pack'),
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Vendus en crédits dans la page Crédits du client : les tokens s’ajoutent à sa réserve, pour la durée indiquée (vide = sans limite). Aucun pack n’est en vente tant que tu n’en crées pas.'),
      list,
      save,
    ),
  );
  // Réglages de l'agent : chaque étape renvoie tout au modèle (consignes, CV, historique) ; moins d'étapes = moins cher.
  const TUNE = [
    ['ai.maxSteps', 'Étapes maximum par demande', 'Chaque étape renvoie tout au modèle. 4 à 6 suffisent en général.'],
    ['ai.historySent', 'Messages d’historique envoyés', 'Pour les suites (« et ajoute aussi… »). Moins = moins cher.'],
    ['ai.maxTokensPerRequest', 'Plafond de tokens par demande', 'Au-delà, l’agent s’arrête proprement et garde ce qui est fait. 0 = aucun.'],
    ['ai.maxSkills', 'Skills chargées au plus par demande', 'Une skill ajoute son texte à chaque étape.'],
  ];
  const tuneInputs = TUNE.map(([key, label, help]) => ({ key, label, help, input: h('input', { class: 'admin-input', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: setting(key).value, 'aria-label': label }) }));
  const saveTune = h('button', { type: 'button', class: 'btn-primary' }, 'Enregistrer');
  saveTune.addEventListener('click', async () => {
    saveTune.disabled = true;
    for (const t of tuneInputs) {
      const res = await api('setSetting', { key: t.key, value: t.input.value.trim() });
      if (!res.ok) return ((saveTune.disabled = false), fail(res.error));
    }
    render();
  });
  const tuneCard = card(
    'Réglages de l’agent',
    null,
    h('div', { class: 'ad-form' }, ...tuneInputs.map((t) => h('label', { class: 'ad-label' }, t.label, t.input, h('span', { class: 'ad-sub' }, t.help))), saveTune),
  );

  // Coûts : tokens et FCFA (prix saisis), face à l'argent encaissé par les crédits.
  const c = r.costs;
  const PRICE_KEYS = ['ai.price.ollama', 'ai.price.gemini', 'ai.price.groq', 'ai.alertDailyFcfa'];
  const priceInputs = PRICE_KEYS.map((key) => ({ key, input: h('input', { class: 'admin-input', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: setting(key).value, 'aria-label': setting(key).label }) }));
  const savePrices = h('button', { type: 'button', class: 'btn-ghost' }, 'Enregistrer les prix');
  savePrices.addEventListener('click', async () => {
    savePrices.disabled = true;
    for (const p of priceInputs) {
      const res = await api('setSetting', { key: p.key, value: p.input.value.trim() });
      if (!res.ok) return ((savePrices.disabled = false), fail(res.error));
    }
    render();
  });
  const KIND = { agent: 'Assistant', translate: 'Traduction', import: 'Import de CV' };
  const costLines = c.lines.map((l) =>
    h(
      'div',
      { class: 'row-item' },
      h('div', { class: 'row-main' }, h('strong', {}, `${KIND[l.kind] ?? l.kind} · ${l.provider}`), h('small', {}, `${tokens(l.requests)} demande${l.requests > 1 ? 's' : ''} · ${tokens(l.month)} tokens sur 30 jours · ${tokens(l.today)} aujourd’hui`)),
      h('span', { class: 'row-meta' }, c.priced ? fcfa(l.costMonth) : '—'),
    ),
  );
  const margin = c.revenueMonth - c.costMonth;
  const costCard = card(
    'Coûts de l’IA',
    c.alerting ? h('span', { class: 'tag danger' }, 'Seuil du jour dépassé') : null,
    h(
      'div',
      { class: 'stat-grid' },
      statCell('Aujourd’hui', c.priced ? fcfa(c.costToday) : `${tokens(c.tokensToday)} tk`, c.priced ? `${tokens(c.tokensToday)} tokens` : 'renseigne les prix'),
      statCell('30 jours', c.priced ? fcfa(c.costMonth) : `${tokens(c.tokensMonth)} tk`, c.priced ? `${tokens(c.tokensMonth)} tokens` : 'renseigne les prix'),
      statCell('Crédits encaissés', fcfa(c.revenueMonth), '30 jours, réel'),
      statCell('Marge IA', c.priced ? fcfa(margin) : '—', c.priced ? (margin >= 0 ? 'encaissé − coût' : 'l’IA coûte plus qu’elle ne rapporte') : null, c.priced && margin >= 0),
    ),
    rowsOf(costLines, 'Aucune demande à l’IA sur 30 jours.'),
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Prix de chaque fournisseur en FCFA pour un million de tokens (ta facture divisée par les tokens consommés). Sans prix, les coûts restent en tokens.'),
      h('div', { class: 'price-row' }, ...priceInputs.map((p) => h('label', { class: 'ad-label' }, setting(p.key).label, p.input))),
      savePrices,
    ),
  );
  return page('IA des comptes', 'Combien d’IA chaque compte reçoit, ce que l’agent a le droit de dépenser, et ce que ça coûte. Les réglages d’un compte précis sont dans Utilisateurs.', null, costCard, rulesCard, tuneCard, packsCard);
}

// --- Contact ------------------------------------------------------------------------------
// Les vraies coordonnées de salacv, affichées sur le site avec le logo de chaque réseau. Vide = n'apparaît pas.
async function contactView() {
  const r = await api('contact');
  if (!r.ok) return page('Contact', null, null, notice(r.error, 'error'));
  const FIELDS = [
    ['contact.email', 'E-mail', 'email', 'contact@salacv.online'],
    ['contact.whatsapp', 'WhatsApp', 'tel', '+242 06 123 45 67'],
    ['contact.facebook', 'Facebook', 'url', 'https://www.facebook.com/salacv'],
    ['contact.tiktok', 'TikTok', 'url', 'https://www.tiktok.com/@salacv'],
  ];
  const value = (key) => r.settings.find((s) => s.key === key)?.value ?? '';
  const inputs = Object.fromEntries(FIELDS.map(([key, label, type, placeholder]) => [key, h('input', { class: 'admin-input', type, value: value(key), placeholder, autocomplete: 'off', 'aria-label': label })]));
  const error = h('p', { class: 'admin-notice error', hidden: true });
  const saved = h('span', { class: 'ad-sub', hidden: true }, 'Enregistré.');
  const save = h('button', { type: 'button', class: 'btn-primary' }, 'Enregistrer');
  save.addEventListener('click', async () => {
    save.disabled = true;
    error.hidden = true;
    Object.values(inputs).forEach((i) => i.removeAttribute('aria-invalid'));
    const res = await api('saveContact', { values: Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])) });
    save.disabled = false;
    if (!res.ok) {
      error.hidden = false;
      error.textContent = res.error;
      if (res.field) (inputs[res.field].setAttribute('aria-invalid', 'true'), inputs[res.field].focus());
      return;
    }
    for (const s of res.settings) if (inputs[s.key]) inputs[s.key].value = s.value; // remis en forme par le serveur
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 1800);
  });
  return page(
    'Contact',
    'Les coordonnées de salacv, affichées en bas de la page d’accueil et dans l’aide. Un champ vide n’apparaît pas.',
    null,
    card('Coordonnées', saved, h('div', { class: 'ad-form' }, ...FIELDS.map(([key, label]) => h('label', { class: 'ad-label' }, label, inputs[key])), error, save)),
  );
}

// --- CV de la phase d'essai --------------------------------------------------------------
let engine = null;
async function cvView() {
  const r = await api('cvs', { limit: 500 });
  if (!r.ok) return page('CV d’essai', null, null, notice(r.error, 'error'));
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.cvs, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: `salacv-cv-essai-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const rows = r.cvs.map((c) => {
    const p = c.resume.profile ?? {};
    return h(
      'div',
      { class: 'row-item' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, (p.name ?? '?')[0].toUpperCase()),
      h('div', { class: 'row-main' }, h('strong', {}, p.name ?? 'Sans nom'), h('small', {}, [p.title, c.resume.template, (c.resume.lang ?? 'fr').toUpperCase(), c.username && `@${c.username}`].filter(Boolean).join(' · '))),
      h('span', { class: 'row-meta' }, dateTime(c.at)),
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => preview(c) }, 'Aperçu'),
    );
  });
  return page(
    'CV d’essai',
    'CV générés pendant la phase d’essai, conservés sans photo pour améliorer l’application.',
    r.cvs.length > 0 && h('button', { type: 'button', class: 'btn-ghost', onClick: download }, 'Exporter en JSON'),
    card(`${r.cvs.length} CV`, null, rowsOf(rows, 'Aucun CV généré pour l’instant.')),
  );
}

async function preview(c) {
  const canvas = h('canvas', { class: 'paper' });
  const box = h('div', { class: 'admin-preview' }, canvas);
  const d = openDialog({ title: c.resume.profile?.name ?? 'CV', className: 'admin-preview-dialog', content: box, footer: [h('button', { type: 'button', class: 'btn-primary', onClick: () => d.close() }, 'Fermer')] });
  engine ??= await loadEngine();
  const r = layoutResume(c.resume, engine.fonts);
  if (r.ok) drawDoc(engine, canvas, r.doc, Math.min(520, box.clientWidth || 360));
  else box.replaceChildren(notice('Ce CV ne peut pas être affiché (format ancien ?).', 'error'));
}

// --- Ressources ---------------------------------------------------------------------------
const LISTS = [
  ['metiers', 'Métiers', (x) => x.profession, (x) => [x.domaine, (x.competences ?? []).slice(0, 4).join(', ')]],
  ['domaines', 'Domaines', (x) => x.domaine, (x) => [(x.metiers_types ?? []).slice(0, 4).join(', ')]],
  ['etablissements', 'Établissements', (x) => x.nom, (x) => [x.sigle, x.ville, x.type]],
  ['entreprises', 'Entreprises', (x) => x.nom, (x) => [x.ville, x.secteur]],
];
let resTab = 'metiers';
let resQuery = '';
// Champs du formulaire « Ajouter », par liste (les listes se saisissent séparées par des virgules).
const FIELDS = {
  metiers: [['profession', 'Profession'], ['domaine', 'Domaine'], ['competences', 'Compétences', true], ['intitules_alternatifs', 'Autres intitulés', true], ['villes', 'Villes', true]],
  domaines: [['domaine', 'Domaine'], ['metiers_types', 'Métiers types', true]],
  etablissements: [['nom', 'Nom'], ['sigle', 'Sigle'], ['ville', 'Ville'], ['type', 'Type (université, lycée technique…)'], ['diplomes_courants', 'Diplômes', true], ['facultes_ou_filieres', 'Filières', true]],
  entreprises: [['nom', 'Nom'], ['ville', 'Ville'], ['secteur', 'Secteur'], ['metiers_recrutes', 'Métiers recrutés', true]],
};

async function resourcesView() {
  const r = await api('resources');
  if (!r.ok) return page('Ressources', null, null, notice(r.error, 'error'));
  const res = r.resources;
  const status = h('p', { class: 'admin-error', 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'res-file' });
  const area = h('textarea', { class: 'admin-input admin-json', rows: 6, placeholder: 'Colle ici le JSON renvoyé par Gemini (metiers, domaines, etablissements, entreprises, structure_cv)…' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) area.value = await f.text();
  });
  const save = async () => {
    let data;
    try {
      data = JSON.parse(area.value);
    } catch {
      return (status.textContent = 'JSON invalide : vérifie les virgules et les guillemets.');
    }
    const out = await api('setResources', { resources: data });
    if (!out.ok) return (status.textContent = out.error);
    render();
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: 'salacv-ressources.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const [, label, title, meta] = LISTS.find(([k]) => k === resTab);
  // Enregistre une copie modifiée (ajout / suppression) puis réaffiche.
  const commit = async (next) => {
    const out = await api('setResources', { resources: next });
    if (!out.ok) return alert(out.error);
    render();
  };
  const remove = (x) => {
    if (!confirm(`Supprimer « ${title(x)} » ?`)) return;
    commit({ ...res, [resTab]: res[resTab].filter((y) => y !== x) });
  };
  const q = resQuery.trim().toLowerCase();
  const list = (res?.[resTab] ?? []).filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q));
  const rows = list.map((x) =>
    h(
      'div',
      { class: 'row-item' },
      h('div', { class: 'row-main' }, h('strong', {}, title(x) ?? '—'), h('small', {}, meta(x).filter(Boolean).join(' · '))),
      x.sources?.[0] && h('a', { class: 'row-link', href: x.sources[0], target: '_blank', rel: 'noopener noreferrer' }, 'Source ↗'),
      h('button', { type: 'button', class: 'row-del', title: 'Supprimer', 'aria-label': 'Supprimer', onClick: () => remove(x) }, '✕'),
    ),
  );
  const search = h('input', { class: 'admin-input', type: 'search', placeholder: `Rechercher dans ${label.toLowerCase()}…`, value: resQuery });
  search.addEventListener('input', () => {
    resQuery = search.value;
    clearTimeout(search._t);
    search._t = setTimeout(async () => {
      await render();
      const el = document.querySelector('.res-search');
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }, 250);
  });
  search.classList.add('res-search');
  // Ajouter un élément à la liste ouverte.
  const inputs = FIELDS[resTab].map(([key, lab, many]) => [key, many, h('input', { class: 'admin-input', placeholder: many ? `${lab} (séparés par des virgules)` : lab })]);
  const add = () => {
    const item = {};
    for (const [key, many, el] of inputs) {
      const v = el.value.trim();
      if (v) item[key] = many ? v.split(',').map((t) => t.trim()).filter(Boolean) : v;
    }
    const main = FIELDS[resTab][0][0];
    if (!item[main]) return inputs[0][2].focus();
    commit({ ...res, [resTab]: [item, ...(res?.[resTab] ?? [])] });
  };
  const addCard = card(`Ajouter · ${label}`, null, h('div', { class: 'card-pad res-add' }, inputs.map(([, , el]) => el), h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn-primary', onClick: add }, 'Ajouter'))));
  return page(
    'Ressources',
    res?.updatedAt ? `Mises à jour ${relativeDate(res.updatedAt)}. Elles servent aux suggestions du studio et à l’agent.` : 'Métiers, compétences, établissements et entreprises, issus de la recherche web.',
    res && h('button', { type: 'button', class: 'btn-ghost', onClick: exportJson }, 'Exporter'),
    res &&
      card(
        'Contenu',
        null,
        h('div', { class: 'stat-grid' }, ...LISTS.map(([k, label]) => statCell(label, res[k]?.length ?? 0, null))),
      ),
    card(
      res ? 'Listes' : 'Aucune ressource',
      null,
      h('div', { class: 'chips' }, LISTS.map(([key, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(resTab === key), onClick: () => ((resTab = key), render()) }, `${label} · ${res?.[key]?.length ?? 0}`))),
      h('div', { class: 'card-pad' }, search),
      rowsOf(rows, res ? (q ? 'Aucun résultat.' : 'Rien dans cette liste.') : 'Importe le JSON de la recherche ci-dessous.'),
    ),
    addCard,
    card(
      res ? 'Remplacer les ressources' : 'Importer les ressources',
      null,
      h('div', { class: 'card-pad' }, area, status, h('div', { class: 'row' }, h('label', { class: 'btn-ghost', for: 'res-file' }, 'Choisir un fichier .json'), file, h('button', { type: 'button', class: 'btn-primary', onClick: save }, 'Enregistrer'))),
    ),
  );
}

// --- Modèles de CV -----------------------------------------------------------------------
// Chaque modèle : disponible ou non, et pour qui (tous, Lite, Pro). Le studio suit ces réglages.
async function templatesView() {
  const r = await api('templates');
  if (!r.ok) return page('Modèles', null, null, notice(r.error, 'error'));
  const settings = r.templates ?? {};
  const specs = r.specs ?? [];
  for (const spec of specs) registerTemplate(templateFromSpec(spec));
  const list = [...TEMPLATES, ...specs.filter((x) => !TEMPLATES.some((t) => t.id === x.id)).map((x) => ({ id: x.id, name: x.name, uploaded: true }))];
  const save = async (id, patch) => {
    const cur = { enabled: true, audience: 'all', ...settings[id], ...patch };
    const out = await api('setTemplate', { id, ...cur });
    if (!out.ok) return alert(out.error);
    settings[id] = cur;
  };
  engine ??= await loadEngine();
  const base = toResume(normalizeState({}), { mockup: example });
  const rows = list.map((t) => {
    const s = { enabled: true, audience: 'all', ...settings[t.id] };
    const thumb = h('canvas', { class: 'tpl-admin-thumb' });
    const lay = layoutResume({ ...base, template: t.id }, engine.fonts);
    if (lay.ok) requestAnimationFrame(() => drawDoc(engine, thumb, lay.doc, 44));
    const avail = h('input', { type: 'checkbox', checked: s.enabled || null });
    avail.addEventListener('change', () => save(t.id, { enabled: avail.checked }).then(() => row.classList.toggle('blocked', !avail.checked)));
    const aud = h('select', { class: 'admin-input tpl-aud' }, [['all', 'Tous'], ['lite', 'Lite'], ['pro', 'Pro']].map(([v, l]) => h('option', { value: v, selected: s.audience === v || null }, l)));
    aud.addEventListener('change', () => save(t.id, { audience: aud.value }));
    const row = h(
      'div',
      { class: `row-item${s.enabled ? '' : ' blocked'}` },
      thumb,
      h('div', { class: 'row-main' }, h('strong', {}, t.name), h('small', {}, t.id)),
      aud,
      h('label', { class: 'tpl-avail' }, avail, 'Disponible'),
      t.uploaded &&
        h('button', {
          type: 'button',
          class: 'row-del',
          title: 'Supprimer ce modèle téléversé',
          onClick: async () => {
            if (!confirm(`Supprimer le modèle « ${t.name} » ?`)) return;
            const out = await api('deleteTemplateSpec', { id: t.id });
            if (!out.ok) return alert(out.error);
            render();
          },
        }, '✕'),
    );
    return row;
  });

  // Téléverser un modèle écrit dans le DSL (JSON) : aperçu, puis enregistrement.
  const area = h('textarea', { class: 'admin-input admin-json', rows: 12, spellcheck: 'false' });
  area.value = JSON.stringify(CANVAS_EXAMPLE, null, 2);
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'tpl-file' });
  file.addEventListener('change', async () => file.files?.[0] && ((area.value = await file.files[0].text()), preview()));
  const status = h('p', { class: 'admin-error', 'aria-live': 'polite' });
  const prev = h('canvas', { class: 'tpl-dsl-preview' });
  const readSpec = () => {
    try {
      return parseTemplateSpec(JSON.parse(area.value));
    } catch {
      return { ok: false, error: 'JSON invalide : vérifie les virgules et les guillemets.' };
    }
  };
  function preview() {
    const r = readSpec();
    status.textContent = r.ok ? '' : r.error;
    if (!r.ok) return;
    registerTemplate(templateFromSpec(r.spec));
    const lay = layoutResume({ ...base, template: r.spec.id }, engine.fonts);
    if (lay.ok) drawDoc(engine, prev, lay.doc, 260);
  }
  let timer;
  area.addEventListener('input', () => (clearTimeout(timer), (timer = setTimeout(preview, 300))));
  requestAnimationFrame(preview);
  const saveSpec = async () => {
    const r = readSpec();
    if (!r.ok) return (status.textContent = r.error);
    const out = await api('saveTemplateSpec', { spec: r.spec });
    if (!out.ok) return (status.textContent = out.error);
    render();
  };
  const upload = card(
    'Téléverser un modèle (DSL)',
    h('a', { class: 'row-link', href: 'https://github.com/ml87-maker/smlab/blob/main/docs/modeles-dsl.md', target: '_blank', rel: 'noopener noreferrer' }, 'Référence du DSL ↗'),
    h(
      'div',
      { class: 'card-pad tpl-dsl' },
      h('div', { class: 'tpl-dsl-edit' }, area, status, h('div', { class: 'row' }, h('label', { class: 'btn-ghost', for: 'tpl-file' }, 'Choisir un fichier .json'), file, h('button', { type: 'button', class: 'btn-primary', onClick: saveSpec }, 'Enregistrer le modèle'))),
      h('div', { class: 'tpl-dsl-side' }, h('span', { class: 'admin-label' }, 'Aperçu en direct'), prev),
    ),
  );
  // Le skill : à donner à n'importe quel agent (Claude, Gemini, ChatGPT…) avec l'image d'un CV ;
  // il répond avec le JSON à coller ci-dessus.
  const copied = h('span', { class: 'admin-label', 'aria-live': 'polite' });
  const skillCard = card(
    'Skill pour les agents',
    null,
    h(
      'div',
      { class: 'card-pad skill-share' },
      h('p', { class: 'admin-hint' }, 'Donne ce skill à un agent (Claude, Gemini, ChatGPT…) avec n’importe quelle image de CV : il la décrit en formes, textes et zones avec nos variables ({{name}}, {{title}}…), et répond avec le JSON à coller dans « Téléverser un modèle ».'),
      h('pre', { class: 'skill-text' }, SKILL),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn-primary', onClick: async () => { await navigator.clipboard?.writeText(SKILL).catch(() => {}); copied.textContent = 'Copié ✓'; } }, 'Copier le skill'),
        h('button', {
          type: 'button',
          class: 'btn-ghost',
          onClick: () => {
            const url = URL.createObjectURL(new Blob([SKILL], { type: 'text/markdown' }));
            h('a', { href: url, download: 'SKILL.md' }).click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
          },
        }, 'Télécharger SKILL.md'),
        copied,
      ),
    ),
  );
  // Modèle par défaut : les visiteurs arrivent dessus (landing, nouveau CV) ; un compte reprend son dernier modèle.
  const pick = h('select', { class: 'admin-input', 'aria-label': 'Modèle par défaut' }, list.map((t) => h('option', { value: t.id, selected: t.id === r.defaultTemplate || null }, t.name)));
  const saved = h('span', { class: 'ad-sub', hidden: true }, 'Enregistré.');
  pick.addEventListener('change', async () => {
    const out = await api('setSetting', { key: 'studio.defaultTemplate', value: pick.value });
    if (!out.ok) return alert(out.error);
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 1800);
  });
  const defaultCard = card(
    'Modèle par défaut',
    saved,
    h('div', { class: 'ad-form' }, h('p', { class: 'ad-sub' }, 'Les visiteurs arrivent sur ce modèle : en tête de la landing et pour un nouveau CV. Un compte connecté reprend le dernier modèle qu’il a utilisé.'), pick),
  );
  return page('Modèles', 'Disponible ou non, et pour qui : tous, Lite (étudiants) ou Pro. Un CV qui utilise déjà un modèle retiré le garde.', null, defaultCard, card(`${list.length} modèles`, null, rowsOf(rows, 'Aucun modèle.')), upload, skillCard);
}

// --- Skills de l'agent ----------------------------------------------------------------------
async function skillsView() {
  const r = await api('skills');
  if (!r.ok) return page('Skills', null, null, notice(r.error, 'error'));
  const edit = (skill = {}) => {
    const f = (label, key, attrs = {}) => {
      const el = h(attrs.rows ? 'textarea' : 'input', { class: 'admin-input', value: skill[key] ?? '', ...attrs });
      return [h('label', { class: 'admin-label' }, label), el];
    };
    const [l1, slug] = f('Slug (identifiant)', 'slug', { placeholder: 'metiers-petrole', disabled: Boolean(skill.slug) });
    const [l2, title] = f('Titre', 'title', { placeholder: 'Métiers du pétrole' });
    const [l3, description] = f('Quand l’agent doit la charger', 'description', { placeholder: 'CV pour les métiers du pétrole à Pointe-Noire (HSE, forage…)' });
    const [l4, content] = f('Contenu (Markdown)', 'content', { rows: 12, placeholder: '# Format…\n- …' });
    const error = h('p', { class: 'admin-error', 'aria-live': 'polite' });
    const d = openDialog({
      title: skill.slug ? `Skill « ${skill.title} »` : 'Nouvelle skill',
      className: 'admin-skill-dialog',
      content: [l1, slug, l2, title, l3, description, l4, content, error],
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn-primary',
            onClick: async () => {
              const res = await api('saveSkill', { skill: { slug: slug.value, title: title.value, description: description.value, content: content.value } });
              if (!res.ok) return (error.textContent = res.error);
              d.close();
              render();
            },
          },
          'Enregistrer',
        ),
      ],
    });
  };
  const remove = (s) => {
    const d = openDialog({
      title: `Supprimer « ${s.title} » ?`,
      content: h('p', { class: 'dialog-text' }, 'L’agent ne pourra plus charger cette skill.'),
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn-primary danger-fill', onClick: async () => (d.close(), await api('deleteSkill', { slug: s.slug }), render()) }, 'Supprimer'),
      ],
    });
  };
  const row = (s, builtin) =>
    h(
      'div',
      { class: 'row-item' },
      h('div', { class: 'row-main' }, h('strong', {}, s.title, builtin && h('span', { class: 'tag' }, 'Code')), h('small', {}, `${s.slug} · ${s.description ?? ''}`)),
      s.updatedAt && h('span', { class: 'row-meta' }, relativeDate(s.updatedAt)),
      !builtin && h('button', { type: 'button', class: 'btn-ghost', onClick: () => edit(s) }, 'Modifier'),
      !builtin && h('button', { type: 'button', class: 'btn-ghost danger-btn', onClick: () => remove(s) }, 'Supprimer'),
    );
  return page(
    'Skills',
    'L’agent voit le titre et la description de chaque skill, et charge son contenu quand la demande y correspond.',
    h('button', { type: 'button', class: 'btn-primary', onClick: () => edit() }, 'Nouvelle skill'),
    card('Skills du code', null, rowsOf(r.builtin.map((x) => row(x, true)), '—')),
    card('Skills ajoutées', null, rowsOf(r.custom.map((x) => row(x, false)), 'Aucune pour l’instant.')),
  );
}


// --- Clés IA : pool partagé, attribution, réglages ------------------------------------------------
// Aucune clé n'est jamais affichée après son enregistrement : seulement les 4 derniers caractères.
async function keysView() {
  const r = await api('keys');
  if (!r.ok) return page('Clés IA', null, null, notice(r.error, 'error'));
  const setting = (key) => r.settings.find((s) => s.key === key);

  async function saveSetting(key, value, done) {
    const res = await api('setSetting', { key, value });
    if (!res.ok) return notice2(res.error);
    done?.();
    render();
  }
  const notice2 = (text) => {
    const d = openDialog({ title: 'Impossible', content: h('p', { class: 'dialog-text' }, text), footer: [h('button', { type: 'button', class: 'btn-primary', onClick: () => d.close() }, 'OK')] });
  };
  // Secrets chiffrés avec une ancienne clé maîtresse : ils ne servent plus, il faut les ressaisir (ou supprimer les clés).
  const lostSettings = r.settings.filter((s) => s.unreadable);
  const lostKeys = r.keys.filter((k) => k.unreadable);
  const lostNotice =
    lostSettings.length || lostKeys.length
      ? notice(
      `La clé maîtresse a changé : ${[
        lostKeys.length && `${lostKeys.length} clé${lostKeys.length > 1 ? 's' : ''} IA`,
        lostSettings.length && `${lostSettings.length} réglage${lostSettings.length > 1 ? 's' : ''} secret${lostSettings.length > 1 ? 's' : ''} (${lostSettings.map((s) => s.label).join(', ')})`,
      ]
        .filter(Boolean)
        .join(' et ')} ne peuvent plus être lus. Ressaisis-les ; supprime les clés marquées « Illisible » et ajoute-les à nouveau.`,
          'error',
        )
      : null;

  // Phrase de récupération : sauvegarde chiffrée de la clé maîtresse, rendue seulement avec la phrase.
  const rec = r.recovery ?? { saved: false };
  const showKeys = (k) => {
    const row = (name, value) =>
      h('div', { class: 'ad-label' }, name, h('code', { class: 'admin-input', style: 'user-select:all;overflow-wrap:anywhere;height:auto;padding:.5rem .6rem' }, value));
    const d = openDialog({
      title: 'Clé maîtresse récupérée',
      content: [
        h('p', { class: 'dialog-text' }, 'Remets ces valeurs dans les variables d’environnement (Vercel → Settings → Environment Variables), puis redéploie. Ne les copie nulle part ailleurs.'),
        row('SALACV_MASTER_KEY', k.masterKey),
        k.sessionSecret && row('SALACV_SESSION_SECRET', k.sessionSecret),
      ],
      footer: [h('button', { type: 'button', class: 'btn-primary', onClick: () => d.close() }, 'Fermer')],
    });
  };
  const pass1 = h('input', { class: 'admin-input', type: 'password', autocomplete: 'new-password', placeholder: 'Phrase de récupération (12 caractères minimum)', 'aria-label': 'Phrase de récupération' });
  const pass2 = h('input', { class: 'admin-input', type: 'password', autocomplete: 'new-password', placeholder: 'La même, une seconde fois', 'aria-label': 'Confirmer la phrase' });
  const passRecover = h('input', { class: 'admin-input', type: 'password', autocomplete: 'off', placeholder: 'Ta phrase de récupération', 'aria-label': 'Phrase de récupération' });
  const recoveryCard = card(
    'Phrase de récupération',
    h('span', { class: rec.saved && rec.current ? 'tag' : 'tag danger' }, !rec.saved ? 'Non définie' : rec.current ? 'À jour' : 'Ancienne clé'),
    h(
      'div',
      { class: 'ad-form' },
      h(
        'p',
        { class: 'ad-sub' },
        'Une copie de la clé maîtresse (et du secret de session) est gardée en base, chiffrée par ta phrase. La phrase n’est enregistrée nulle part : note-la hors ligne. Si la clé maîtresse est perdue, ta phrase la rend.',
      ),
      rec.saved && h('p', { class: 'ad-sub' }, `Sauvegarde du ${dateTime(rec.at)}${rec.current ? ', correspond à la clé en service.' : ' : elle contient une AUTRE clé que celle en service (la clé a changé depuis). Récupère-la si c’est l’ancienne que tu cherches, ou refais la sauvegarde.'}`),
      pass1,
      pass2,
      h(
        'button',
        {
          type: 'button',
          class: 'btn-primary',
          onClick: async () => {
            const res = await api('saveRecovery', { passphrase: pass1.value, confirm: pass2.value });
            pass1.value = '';
            pass2.value = '';
            res.ok ? render() : notice2(res.error);
          },
        },
        rec.saved ? 'Refaire la sauvegarde avec cette phrase' : 'Enregistrer la phrase',
      ),
      rec.saved &&
        h(
          'div',
          { class: 'ad-form', style: 'margin-top:.75rem' },
          h('strong', {}, 'Récupérer la clé maîtresse'),
          passRecover,
          h(
            'button',
            {
              type: 'button',
              class: 'btn-ghost',
              onClick: async () => {
                const res = await api('recoverMaster', { passphrase: passRecover.value });
                passRecover.value = '';
                res.ok ? showKeys(res) : notice2(res.error);
              },
            },
            'Récupérer',
          ),
        ),
    ),
  );

  const quotaFields = ['quota.anonTokens', 'quota.ipTokens'].map((k) => ({ k, input: h('input', { class: 'admin-input', type: 'number', min: 0, step: 1000, value: setting(k).value, 'aria-label': setting(k).label }) }));
  const quotaCard = card(
    'Quota IA des visiteurs non connectés',
    null,
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Tokens gratuits, UNE SEULE FOIS (jamais remis à zéro), comptés côté serveur par session ET par adresse IP : le plus bas des deux bloque. Seules les clés étiquetées « public » servent aux visiteurs. Attention : une IP partagée (cybercafé, université, réseau mobile) cumule les visiteurs.'),
      ...quotaFields.map(({ k, input }) => h('label', { class: 'ad-label' }, setting(k).label, input)),
      h('button', { type: 'button', class: 'btn-primary', onClick: async () => { for (const { k, input } of quotaFields) { const res = await api('setSetting', { key: k, value: input.value }); if (!res.ok) return notice2(res.error); } render(); } }, 'Enregistrer les quotas'),
    ),
  );
  const r2Fields = ['r2.accountId', 'r2.accessKeyId', 'r2.secretAccessKey', 'r2.bucket'].map((k) => {
    const s = setting(k);
    return { k, secret: s.secret, input: h('input', { class: 'admin-input', type: s.secret ? 'password' : 'text', autocomplete: 'off', value: s.secret ? '' : s.value, placeholder: s.secret ? (s.unreadable ? 'Illisible (ancienne clé maîtresse) — à ressaisir' : s.set ? `Enregistrée (${s.hint}) — laisse vide pour la garder` : 'À renseigner') : s.label, 'aria-label': s.label }) };
  });
  const r2Card = card(
    'Stockage R2 (CV et PDF des clients)',
    h('span', { class: r.r2 ? 'tag' : 'tag danger' }, r.r2 ? 'Configuré' : 'Non configuré'),
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Les CV des comptes connectés (et leurs PDF payés) sont écrits sur Cloudflare R2. Les clés d’accès sont chiffrées en base et ne s’affichent plus jamais. Tant que R2 n’est pas configuré, les CV sont gardés dans la base.'),
      ...r2Fields.map(({ k, input }) => h('label', { class: 'ad-label' }, setting(k).label, input)),
      h('button', { type: 'button', class: 'btn-primary', onClick: async () => { for (const { k, secret, input } of r2Fields) { if (secret && !input.value) continue; const res = await api('setSetting', { key: k, value: input.value.trim() }); if (!res.ok) return notice2(res.error); } render(); } }, 'Enregistrer R2'),
    ),
  );
  const fbFields = ['firebase.apiKey', 'firebase.authDomain', 'firebase.projectId'].map((k) => ({ k, input: h('input', { class: 'admin-input', value: setting(k).value, placeholder: setting(k).label, 'aria-label': setting(k).label }) }));
  const settingsCard = card(
    'Connexion Google (Firebase)',
    null,
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Valeurs publiques par nature : le site les lit à l’ouverture, rien à redéployer.'),
      ...fbFields.map(({ k, input }) => h('label', { class: 'ad-label' }, setting(k).label, input)),
      h('button', { type: 'button', class: 'btn-primary', onClick: async () => { for (const { k, input } of fbFields) await api('setSetting', { key: k, value: input.value.trim() }); render(); } }, 'Enregistrer Firebase'),
    ),
  );

  // Ajouter une clé
  const provider = h('select', { class: 'admin-input', 'aria-label': 'Fournisseur' }, r.providers.map((p) => h('option', { value: p }, p)));
  const secret = h('input', { class: 'admin-input', type: 'password', autocomplete: 'off', placeholder: 'Clé d’API (ne sera plus jamais affichée)', 'aria-label': 'Clé d’API' });
  const label = h('input', { class: 'admin-input', placeholder: 'Nom (facultatif)', maxlength: 60, 'aria-label': 'Nom' });
  const owner = h('select', { class: 'admin-input', 'aria-label': 'Destinataire' }, h('option', { value: '' }, 'Pool partagé (tous les utilisateurs sans clé)'), r.users.map((u) => h('option', { value: u }, `Attribuer à ${u}`)));
  const pub = h('input', { type: 'checkbox', id: 'key-public' });
  const pubLabel = h('label', { class: 'ad-check', for: 'key-public' }, pub, h('span', {}, 'Public : utilisable par les visiteurs non connectés (dans leur quota)'));
  owner.addEventListener('change', () => { pub.disabled = Boolean(owner.value); if (owner.value) pub.checked = false; });
  const error = h('p', { class: 'admin-notice error', hidden: true });
  const addCard = card(
    'Ajouter une clé',
    null,
    h(
      'div',
      { class: 'ad-form' },
      h('div', { class: 'ad-grid' }, provider, label, owner),
      secret,
      pubLabel,
      error,
      h(
        'button',
        {
          type: 'button',
          class: 'btn-primary',
          onClick: async () => {
            error.hidden = true;
            const res = await api('addKey', { provider: provider.value, key: secret.value, label: label.value, owner: owner.value || null, public: pub.checked });
            secret.value = '';
            if (!res.ok) return (error.textContent = res.error), (error.hidden = false);
            render();
          },
        },
        'Ajouter',
      ),
    ),
  );

  // Liste
  function assign(k) {
    const pick = h('select', { class: 'admin-input' }, h('option', { value: '' }, 'Pool partagé'), r.users.map((u) => h('option', { value: u, selected: u === k.owner || null }, u)));
    const d = openDialog({
      title: `Attribuer la clé ${k.provider} …${k.last4}`,
      content: [h('p', { class: 'dialog-text' }, 'Une clé attribuée ne sert qu’à ce client : dès qu’il a des clés attribuées, il ne consomme jamais le pool partagé.'), pick],
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn-primary', onClick: async () => { const res = await api('assignKey', { id: k.id, username: pick.value || null }); d.close(); res.ok ? render() : notice2(res.error); } }, 'Attribuer'),
      ],
    });
  }
  function remove(k) {
    const d = openDialog({
      title: `Supprimer la clé ${k.provider} …${k.last4} ?`,
      content: h('p', { class: 'dialog-text' }, 'La clé est effacée de la base. Elle ne pourra pas être récupérée.'),
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => d.close() }, 'Annuler'),
        h('button', { type: 'button', class: 'btn-primary danger-fill', onClick: async () => { const res = await api('deleteKey', { id: k.id }); d.close(); res.ok ? render() : notice2(res.error); } }, 'Supprimer'),
      ],
    });
  }
  const rows = r.keys.map((k) =>
    h(
      'div',
      { class: `row-item${k.disabled ? ' blocked' : ''}` },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, k.provider[0].toUpperCase()),
      h(
        'div',
        { class: 'row-main' },
        h('strong', {}, `${k.provider} …${k.last4}`, k.unreadable && h('span', { class: 'tag danger' }, 'Illisible'), k.label && h('span', { class: 'tag' }, k.label), k.public && h('span', { class: 'tag' }, 'Public'), k.disabled && h('span', { class: 'tag danger' }, 'Désactivée'), k.exhaustedToday && h('span', { class: 'tag' }, 'Épuisée aujourd’hui')),
        h('small', {}, `${k.owner ? `Attribuée à ${k.owner}` : 'Pool partagé'}${k.disabledReason ? ` · ${k.disabledReason}` : ''}`),
      ),
      !k.owner && h('button', { type: 'button', class: 'btn-ghost', onClick: async () => { const res = await api('setKeyPublic', { id: k.id, public: !k.public }); res.ok ? render() : notice2(res.error); } }, k.public ? 'Retirer du public' : 'Rendre public'),
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => assign(k) }, 'Attribuer'),
      h('button', { type: 'button', class: 'btn-ghost', onClick: async () => { const res = await api('setKeyDisabled', { id: k.id, disabled: !k.disabled }); res.ok ? render() : notice2(res.error); } }, k.disabled ? 'Réactiver' : 'Désactiver'),
      h('button', { type: 'button', class: 'btn-ghost danger-btn', onClick: () => remove(k) }, 'Supprimer'),
    ),
  );
  const pool = r.keys.filter((k) => !k.owner).length;
  return page(
    'Clés IA',
    'Les clés servent aux clients connectés, en rotation ; celles étiquetées « Public » servent aussi aux visiteurs non connectés, dans leur quota : première clé utilisable, mise de côté sur quota (429) ou si elle est refusée. Un client à qui tu attribues des clés n’utilise que celles-là.',
    null,
    lostNotice,
    recoveryCard,
    quotaCard,
    r2Card,
    settingsCard,
    addCard,
    card(`${r.keys.length} clé${r.keys.length > 1 ? 's' : ''} · ${pool} dans le pool`, null, rowsOf(rows, 'Aucune clé enregistrée. Sans clé, l’assistant utilise les clés d’environnement du serveur, s’il y en a.')),
  );
}

// --- Boutique : prix des crédits et paiement LightPay ------------------------------------------
const fcfa = (n) => `${Number(n).toLocaleString('fr-FR')} FCFA`;
const ORDER_STATUS = { PAID: 'Payée', PENDING: 'En attente', EXPIRED: 'Expirée', CANCELLED: 'Annulée', FAILED: 'Échouée' };

async function shopView() {
  const r = await api('shop');
  if (!r.ok) return page('Boutique', null, null, notice(r.error, 'error'));
  const setting = (key) => r.settings.find((s) => s.key === key);
  const fail = (text) => {
    const d = openDialog({ title: 'Impossible', content: h('p', { class: 'dialog-text' }, text), footer: [h('button', { type: 'button', class: 'btn-primary', onClick: () => d.close() }, 'OK')] });
  };

  // Packs : une ligne par pack, tout est enregistré d'un coup (le serveur valide la liste entière).
  const list = h('div', { class: 'pack-rows' });
  const lines = [];
  const num = (value, label, placeholder = '') => h('input', { class: 'admin-input', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: value ?? '', placeholder, 'aria-label': label });
  function addLine(p = { id: '', credits: '', price: '', promoPrice: null, active: true }) {
    const line = {
      id: p.id,
      credits: num(p.credits, 'Crédits'),
      price: num(p.price, 'Prix (FCFA)'),
      promo: num(p.promoPrice, 'Prix promo (FCFA)', 'Aucun'),
      active: h('input', { type: 'checkbox', checked: p.active || null, 'aria-label': 'En vente' }),
    };
    const remove = h('button', { type: 'button', class: 'btn-ghost danger-btn' }, 'Retirer');
    const el = h(
      'div',
      { class: 'pack-row' },
      h('label', { class: 'ad-label' }, 'Crédits', line.credits),
      h('label', { class: 'ad-label' }, 'Prix (FCFA)', line.price),
      h('label', { class: 'ad-label' }, 'Prix promo', line.promo),
      h('label', { class: 'ad-check' }, line.active, h('span', {}, 'En vente')),
      remove,
    );
    remove.addEventListener('click', () => {
      lines.splice(lines.indexOf(line), 1);
      el.remove();
    });
    lines.push(line);
    list.append(el);
  }
  r.packs.forEach(addLine);

  const save = h('button', { type: 'button', class: 'btn-primary' }, 'Enregistrer les prix');
  save.addEventListener('click', async () => {
    const used = new Set(lines.map((l) => l.id).filter(Boolean));
    const packs = lines.map((l) => {
      const credits = Number.parseInt(l.credits.value, 10);
      // Un pack existant garde son identifiant ; un nouveau prend c<crédits> (c<crédits>-2 si déjà pris).
      let id = l.id;
      if (!id) {
        id = `c${credits}`;
        for (let n = 2; used.has(id); n++) id = `c${credits}-${n}`;
        used.add(id);
      }
      return { id, credits, price: Number.parseInt(l.price.value, 10), promoPrice: l.promo.value.trim() === '' ? null : Number.parseInt(l.promo.value, 10), active: l.active.checked };
    });
    save.disabled = true;
    const res = await api('savePacks', { packs });
    save.disabled = false;
    res.ok ? render() : fail(res.error);
  });
  const packsCard = card(
    'Prix des crédits',
    h('button', { type: 'button', class: 'btn-ghost', onClick: () => addLine() }, 'Ajouter un pack'),
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Prix en FCFA, minimum 100. Un prix promo remplace le prix normal, affiché barré à côté. Décoche « En vente » pour retirer un pack sans le perdre.'),
      list,
      save,
    ),
  );

  // LightPay : environnement, clés, wallet qui reçoit l'argent.
  const lp = r.lightpay;
  const envSel = h('select', { class: 'admin-input', 'aria-label': 'Environnement' }, ['sandbox', 'production'].map((v) => h('option', { value: v, selected: v === setting('lightpay.env').value || null }, v === 'sandbox' ? 'Test (sandbox)' : 'Réel (production)')));
  const fields = ['lightpay.appId', 'lightpay.apiUrl', 'lightpay.checkoutUrl', 'lightpay.keySandbox', 'lightpay.keyProduction', 'lightpay.testers'].map((k) => {
    const s = setting(k);
    return { k, secret: s.secret, input: h('input', { class: 'admin-input', type: s.secret ? 'password' : 'text', autocomplete: 'off', value: s.secret ? '' : s.value, placeholder: s.secret ? (s.unreadable ? 'Illisible (ancienne clé maîtresse) — à ressaisir' : s.set ? `Enregistrée (${s.hint}) — laisse vide pour la garder` : 'À renseigner') : s.label, 'aria-label': s.label }) };
  });
  const saveLp = h('button', { type: 'button', class: 'btn-primary' }, 'Enregistrer LightPay');
  saveLp.addEventListener('click', async () => {
    saveLp.disabled = true;
    const changes = [['lightpay.env', envSel.value], ...fields.filter((f) => !(f.secret && !f.input.value)).map((f) => [f.k, f.input.value.trim()])];
    for (const [key, value] of changes) {
      const res = await api('setSetting', { key, value });
      if (!res.ok) {
        saveLp.disabled = false;
        return fail(res.error);
      }
    }
    render();
  });
  const where = lp.env === 'production' ? 'réel' : 'test';
  const connect = h('button', { type: 'button', class: 'btn-ghost' }, lp.payee ? 'Reconnecter le wallet' : 'Connecter le wallet');
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    const res = await api('lightpayConnectStart', { redirectUri: `${location.origin}/admin/` });
    if (!res.ok) {
      connect.disabled = false;
      return fail(res.error);
    }
    location.href = res.url;
  });
  const lpCard = card(
    'Paiement LightPay',
    h('span', { class: lp.ready ? 'tag' : 'tag danger' }, lp.ready ? `Ouvert · ${where}` : 'Fermé'),
    h(
      'div',
      { class: 'ad-form' },
      h('p', { class: 'ad-sub' }, 'Les clients paient avec leur wallet LightPay ou par mobile money ; l’argent arrive sur le wallet connecté. Les clés secrètes sont chiffrées en base et ne s’affichent plus.'),
      h('label', { class: 'ad-label' }, setting('lightpay.env').label, envSel),
      ...fields.map(({ k, input }) => h('label', { class: 'ad-label' }, setting(k).label, input)),
      saveLp,
      h('p', { class: 'ad-sub' }, lp.payee ? `Wallet connecté en ${where} : ${lp.payee}` : `Aucun wallet connecté en ${where} : le paiement reste fermé.`),
      connect,
    ),
  );

  const s = r.stats;
  const rows = r.orders.map((o) =>
    h(
      'div',
      { class: 'row-item' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, String(o.credits)),
      h(
        'div',
        { class: 'row-main' },
        h('strong', {}, `${o.credits} crédit${o.credits > 1 ? 's' : ''} · ${fcfa(o.amount)}`, o.env !== 'production' && h('span', { class: 'tag' }, 'Test'), h('span', { class: ['PAID', 'PENDING'].includes(o.status) ? 'tag' : 'tag danger' }, ORDER_STATUS[o.status] ?? o.status)),
        h('small', {}, `${o.username} · ${dateTime(o.at)}`),
      ),
    ),
  );
  return page(
    'Boutique',
    'Les packs de crédits en vente et leur paiement par LightPay. Un achat payé ajoute les crédits au compte du client, une seule fois.',
    null,
    h('div', { class: 'stat-grid' }, statCell('Ventes', s.paid, 'commandes payées'), statCell('Encaissé', fcfa(s.revenue), 'en réel'), statCell('Crédits vendus', s.credits)),
    packsCard,
    lpCard,
    card(`${r.orders.length} commande${r.orders.length > 1 ? 's' : ''} récente${r.orders.length > 1 ? 's' : ''}`, null, rowsOf(rows, 'Aucune commande pour l’instant.')),
  );
}

// Retour de LightPay Connect (/admin/?code=…&state=…) : le wallet de salacv devient celui qui reçoit les paiements.
async function finishConnect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('state')) return;
  history.replaceState(null, '', `${location.pathname}#boutique`);
  const res = q.get('code') ? await api('lightpayConnect', { code: q.get('code'), state: q.get('state') }) : { ok: false, error: 'Connexion du wallet annulée.' };
  if (!res.ok) {
    const d = openDialog({ title: 'Wallet non connecté', content: h('p', { class: 'dialog-text' }, res.error), footer: [h('button', { type: 'button', class: 'btn-primary', onClick: () => d.close() }, 'OK')] });
  }
}

// --- Icônes de la barre latérale --------------------------------------------------------------
const ICON_PATHS = {
  explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 2.8 3 6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  log: '<path d="M8 4h11v16H8z"/><path d="M5 4v16M11 8h5M11 12h5M11 16h3"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3M14 9l2 2"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
};
document.querySelectorAll('.ad-ico').forEach((el) => {
  el.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[el.dataset.i] ?? ''}</svg>`;
});

// --- Barre latérale : masquable (PC), tiroir (mobile) ---------------------------------------
const side = $('side');
const scrim = $('scrim');
const mobile = window.matchMedia('(max-width: 899px)');
let sideOpen = !mobile.matches;
function syncSide() {
  side.hidden = !token || !sideOpen;
  scrim.hidden = side.hidden || !mobile.matches;
}
$('menu').addEventListener('click', () => ((sideOpen = !sideOpen), syncSide()));
scrim.addEventListener('click', () => ((sideOpen = false), syncSide()));
side.addEventListener('click', (e) => e.target.closest('a') && mobile.matches && ((sideOpen = false), syncSide()));
mobile.addEventListener('change', () => ((sideOpen = !mobile.matches), syncSide()));

// --- Recherche dans la page (filtre les lignes affichées) ------------------------------------
const search = $('search');
search.addEventListener('input', () => {
  const q = fold(search.value.trim());
  document.querySelectorAll('.row-item').forEach((row) => (row.hidden = Boolean(q) && !fold(row.textContent).includes(q)));
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && token) {
    e.preventDefault();
    search.focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && token) {
    e.preventDefault();
    sideOpen = !sideOpen;
    syncSide();
  }
});

// --- Navigation ----------------------------------------------------------------------------
const VIEWS = { apercu: overviewView, utilisateurs: usersView, cv: cvView, ressources: resourcesView, modeles: templatesView, skills: skillsView, cles: keysView, boutique: shopView, ia: aiView, contact: contactView, journal: journalView };

async function render() {
  const logged = Boolean(token);
  $('logout').hidden = !logged;
  document.querySelector('.ad-search').hidden = !logged;
  syncSide();
  if (!logged) return view.replaceChildren(loginView());
  const tab = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'apercu';
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  search.value = '';
  const content = await VIEWS[tab]();
  view.replaceChildren(content);
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  if (tab !== 'apercu' && !lastOverview) api('overview').then((o) => o.ok && ((lastOverview = o), syncBadge()));
}

window.addEventListener('hashchange', render);
api('whoami').then(async (r) => {
  token = Boolean(r.ok);
  if (token) await finishConnect();
  render();
});
