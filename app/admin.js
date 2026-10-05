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
const TOKEN_KEY = 'salacv:admin';
let token = sessionStorage.getItem(TOKEN_KEY);

$('theme').addEventListener('click', () => openThemePicker());
$('logout').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY);
  token = null;
  render();
});

async function api(action, body = {}) {
  let res;
  try {
    res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    return { ok: false, error: 'Pas de connexion au serveur.' };
  }
  const data = await res.json().catch(() => ({ ok: false, error: `Réponse inattendue (HTTP ${res.status}).` }));
  if (res.status === 401 && action !== 'login') {
    sessionStorage.removeItem(TOKEN_KEY);
    token = null;
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
  const res = o.resources ? Object.values(o.resources).reduce((a, b) => a + b, 0) : 0;
  const journal = o.journal.map(journalRow);
  return page(
    'Aperçu',
    null,
    null,
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
        h('small', {}, `${u.logins} connexion${u.logins > 1 ? 's' : ''} · depuis le ${new Date(u.first).toLocaleDateString('fr-FR')}${u.reason ? ` · ${u.reason}` : ''}`),
      ),
      h('span', { class: 'row-meta' }, u.last ? relativeDate(u.last) : '—'),
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
  return page('Modèles', 'Disponible ou non, et pour qui : tous, Lite (étudiants) ou Pro. Un CV qui utilise déjà un modèle retiré le garde.', null, card(`${list.length} modèles`, null, rowsOf(rows, 'Aucun modèle.')), upload, skillCard);
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
  const error = h('p', { class: 'admin-notice error', hidden: true });
  const addCard = card(
    'Ajouter une clé',
    null,
    h(
      'div',
      { class: 'ad-form' },
      h('div', { class: 'ad-grid' }, provider, label, owner),
      secret,
      error,
      h(
        'button',
        {
          type: 'button',
          class: 'btn-primary',
          onClick: async () => {
            error.hidden = true;
            const res = await api('addKey', { provider: provider.value, key: secret.value, label: label.value, owner: owner.value || null });
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
        h('strong', {}, `${k.provider} …${k.last4}`, k.label && h('span', { class: 'tag' }, k.label), k.disabled && h('span', { class: 'tag danger' }, 'Désactivée'), k.exhaustedToday && h('span', { class: 'tag' }, 'Épuisée aujourd’hui')),
        h('small', {}, `${k.owner ? `Attribuée à ${k.owner}` : 'Pool partagé'}${k.disabledReason ? ` · ${k.disabledReason}` : ''}`),
      ),
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => assign(k) }, 'Attribuer'),
      h('button', { type: 'button', class: 'btn-ghost', onClick: async () => { const res = await api('setKeyDisabled', { id: k.id, disabled: !k.disabled }); res.ok ? render() : notice2(res.error); } }, k.disabled ? 'Réactiver' : 'Désactiver'),
      h('button', { type: 'button', class: 'btn-ghost danger-btn', onClick: () => remove(k) }, 'Supprimer'),
    ),
  );
  const pool = r.keys.filter((k) => !k.owner).length;
  return page(
    'Clés IA',
    'Les clés servent à tous les clients, en rotation : première clé utilisable, mise de côté sur quota (429) ou si elle est refusée. Un client à qui tu attribues des clés n’utilise que celles-là.',
    null,
    settingsCard,
    addCard,
    card(`${r.keys.length} clé${r.keys.length > 1 ? 's' : ''} · ${pool} dans le pool`, null, rowsOf(rows, 'Aucune clé enregistrée. Sans clé, l’assistant utilise les clés d’environnement du serveur, s’il y en a.')),
  );
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
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3M14 9l2 2"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
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
const VIEWS = { apercu: overviewView, utilisateurs: usersView, cv: cvView, ressources: resourcesView, modeles: templatesView, skills: skillsView, cles: keysView, journal: journalView };

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
render();
