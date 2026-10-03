// Admin salacv : utilisateurs (blocage), CV de la phase d'essai, ressources (JSON de la
// recherche web) et skills de l'agent. Même design que le tableau de bord.
import { layoutResume } from '../src/index.js';
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { drawDoc, loadEngine } from './lib/engine.js';
import { openThemePicker } from './lib/theme.js';
import { relativeDate } from './lib/store.js';

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

const header = (title, sub, action) => h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, title), sub && h('p', { class: 'sub' }, sub)), action);
const notice = (text, kind = '') => h('p', { class: `admin-notice ${kind}` }, text);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// --- Connexion -------------------------------------------------------------------------
function loginView() {
  const input = h('input', { class: 'admin-input', type: 'password', placeholder: 'Mot de passe admin', autocomplete: 'current-password', 'aria-label': 'Mot de passe admin' });
  const error = h('p', { class: 'admin-error', 'aria-live': 'polite' });
  const form = h(
    'form',
    { class: 'panel admin-login' },
    h('strong', {}, 'Administration'),
    h('p', {}, 'Accès réservé. Le mot de passe est défini côté serveur (SALACV_ADMIN_PASSWORD).'),
    input,
    error,
    h('button', { class: 'btn-primary', type: 'submit' }, 'Entrer'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('login', { password: input.value });
    if (!r.ok) return (error.textContent = r.error);
    token = r.token;
    sessionStorage.setItem(TOKEN_KEY, token);
    location.hash = '#utilisateurs';
    render();
  });
  requestAnimationFrame(() => input.focus());
  return h('section', { class: 'admin-center' }, form);
}

// --- Vue d'ensemble (en tête de chaque page) ---------------------------------------------
async function overview() {
  const o = await api('overview');
  if (!o.ok) return notice(o.error, 'error');
  const stat = (n, label) => h('div', { class: 'stat' }, h('strong', {}, String(n)), h('span', {}, label));
  return h(
    'div',
    {},
    !o.durable && notice('Stockage temporaire : sur Vercel, ajoute UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN pour garder les données. Sur le VPS, tout est gardé dans data/.', 'warn'),
    h('div', { class: 'stats' }, stat(o.users, 'utilisateurs'), stat(o.blocked, 'bloqués'), stat(o.cvs, 'CV d’essai'), stat(o.skills, 'skills ajoutées')),
  );
}

// --- Utilisateurs ------------------------------------------------------------------------
async function usersView() {
  const r = await api('users');
  if (!r.ok) return notice(r.error, 'error');
  const rows = h('div', { class: 'admin-list' });
  const draw = (q = '') => {
    const list = r.users.filter((u) => fold(u.username).includes(fold(q)));
    rows.replaceChildren(
      ...(list.length
        ? list.map((u) =>
            h(
              'div',
              { class: `admin-row${u.blocked ? ' blocked' : ''}` },
              h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.username[0].toUpperCase()),
              h(
                'div',
                { class: 'row-text' },
                h('strong', {}, u.username, u.blocked && h('span', { class: 'tag danger' }, 'Bloqué')),
                h('small', {}, `${u.logins} connexion${u.logins > 1 ? 's' : ''} · dernière ${u.last ? relativeDate(u.last) : '—'} · depuis ${new Date(u.first).toLocaleDateString('fr-FR')}`, u.reason && ` · ${u.reason}`),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: u.blocked ? 'btn-ghost' : 'btn-ghost danger-btn',
                  onClick: () => (u.blocked ? setBlocked(u, false) : confirmBlock(u)),
                },
                u.blocked ? 'Débloquer' : 'Bloquer',
              ),
            ),
          )
        : [h('p', { class: 'empty' }, q ? 'Aucun utilisateur ne correspond.' : 'Aucun utilisateur pour l’instant. Ils apparaissent à leur première connexion à l’assistant.')]),
    );
  };
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
  const search = h('input', { class: 'admin-input', type: 'search', placeholder: 'Rechercher un utilisateur…', onInput: (e) => draw(e.target.value) });
  draw();
  return h('section', {}, header('Utilisateurs', 'Connexions à l’assistant. Bloquer coupe l’accès à l’assistant et à la traduction.'), await overview(), search, rows);
}

// --- CV de la phase d'essai --------------------------------------------------------------
let engine = null;
async function cvView() {
  const r = await api('cvs', { limit: 500 });
  if (!r.ok) return notice(r.error, 'error');
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.cvs, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: `salacv-cv-essai-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const list = r.cvs.map((c) => {
    const p = c.resume.profile ?? {};
    return h(
      'div',
      { class: 'admin-row' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, (p.name ?? '?')[0].toUpperCase()),
      h('div', { class: 'row-text' }, h('strong', {}, p.name ?? 'Sans nom'), h('small', {}, [p.title, c.resume.template, (c.resume.lang ?? 'fr').toUpperCase(), relativeDate(c.at), c.username && `@${c.username}`].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => preview(c) }, 'Aperçu'),
    );
  });
  return h(
    'section',
    {},
    header('CV d’essai', 'CV générés pendant la phase d’essai, sans photo, pour améliorer l’application.', r.cvs.length > 0 && h('button', { type: 'button', class: 'btn-ghost', onClick: download }, 'Exporter en JSON')),
    await overview(),
    h('div', { class: 'admin-list' }, list.length ? list : h('p', { class: 'empty' }, 'Aucun CV généré pour l’instant.')),
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

async function resourcesView() {
  const r = await api('resources');
  if (!r.ok) return notice(r.error, 'error');
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

  const chips = LISTS.map(([key, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(resTab === key), onClick: () => ((resTab = key), render()) }, `${label} · ${res?.[key]?.length ?? 0}`));
  const [, , title, meta] = LISTS.find(([k]) => k === resTab);
  const items = res?.[resTab] ?? [];
  const search = h('input', { class: 'admin-input', type: 'search', placeholder: 'Filtrer…' });
  const rows = h('div', { class: 'admin-list' });
  const draw = () => {
    const q = fold(search.value);
    rows.replaceChildren(
      ...items
        .filter((x) => fold(JSON.stringify(x)).includes(q))
        .map((x) =>
          h(
            'div',
            { class: 'admin-row' },
            h('div', { class: 'row-text' }, h('strong', {}, title(x) ?? '—'), h('small', {}, meta(x).filter(Boolean).join(' · '))),
            x.sources?.[0] && h('a', { class: 'row-link', href: x.sources[0], target: '_blank', rel: 'noopener noreferrer' }, 'Source ↗'),
          ),
        ),
    );
    if (!rows.children.length) rows.append(h('p', { class: 'empty' }, res ? 'Rien dans cette liste.' : 'Aucune ressource : importe le JSON de la recherche.'));
  };
  search.addEventListener('input', draw);
  draw();

  return h(
    'section',
    {},
    header('Ressources', res?.updatedAt ? `Mises à jour ${relativeDate(res.updatedAt)}. Elles servent aux suggestions et à l’agent.` : 'Métiers, compétences, établissements et entreprises.', res && h('button', { type: 'button', class: 'btn-ghost', onClick: exportJson }, 'Exporter')),
    h(
      'div',
      { class: 'panel admin-import' },
      h('strong', {}, res ? 'Remplacer les ressources' : 'Importer les ressources'),
      area,
      status,
      h('div', { class: 'row' }, h('label', { class: 'btn-ghost', for: 'res-file' }, 'Choisir un fichier .json'), file, h('button', { type: 'button', class: 'btn-primary', onClick: save }, 'Enregistrer')),
    ),
    h('div', { class: 'chips' }, chips),
    search,
    rows,
  );
}

// --- Skills de l'agent ----------------------------------------------------------------------
async function skillsView() {
  const r = await api('skills');
  if (!r.ok) return notice(r.error, 'error');
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
  const remove = async (s) => {
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
      { class: 'admin-row' },
      h('div', { class: 'row-text' }, h('strong', {}, s.title, builtin && h('span', { class: 'tag' }, 'Code')), h('small', {}, `${s.slug} · ${s.description ?? ''}`)),
      !builtin && h('button', { type: 'button', class: 'btn-ghost', onClick: () => edit(s) }, 'Modifier'),
      !builtin && h('button', { type: 'button', class: 'btn-ghost danger-btn', onClick: () => remove(s) }, 'Supprimer'),
    );
  return h(
    'section',
    {},
    header('Skills de l’agent', 'L’agent voit le titre et la description de chaque skill, et charge son contenu quand la demande y correspond.', h('button', { type: 'button', class: 'btn-primary', onClick: () => edit() }, 'Nouvelle skill')),
    h('div', { class: 'admin-list' }, r.builtin.map((s) => row(s, true)), r.custom.map((s) => row(s, false))),
  );
}

// --- Navigation ----------------------------------------------------------------------------
const VIEWS = { utilisateurs: usersView, cv: cvView, ressources: resourcesView, skills: skillsView };

async function render() {
  const logged = Boolean(token);
  $('logout').hidden = !logged;
  document.querySelector('.tabs').hidden = !logged;
  document.querySelector('.admin-tabs').hidden = !logged;
  if (!logged) return view.replaceChildren(loginView());
  const tab = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'utilisateurs';
  document.querySelectorAll('[data-tab]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  view.replaceChildren(h('p', { class: 'empty' }, 'Chargement…'));
  const content = await VIEWS[tab]();
  view.replaceChildren(content);
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
}

window.addEventListener('hashchange', render);
render();
