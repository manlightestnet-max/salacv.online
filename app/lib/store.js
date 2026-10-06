// Données de l'utilisateur : projets (CV), personnalités, crédits, avis, parrainage.
//
// Compte connecté : les CV et les personnalités vivent sur le serveur (R2 / base), jamais dans le navigateur. Ici, une
// copie en mémoire (l'API reste synchrone pour le reste de l'application), synchronisée avec le serveur.
// Visiteur non connecté : SEULE exception, un bac à sable dans ce navigateur (« salacv:sandbox »), pour qu'il ne perde pas
// son travail avant de se connecter. À la connexion, on lui propose de l'ajouter à son compte (syncSandbox), puis il est vidé.
// Sinon, seules des préférences d'interface (thème, mode Lite/Pro, taille du panneau) restent dans le navigateur.
import { emptyState, normalizeState, toResume } from '../state.js';
import { forgetSession, getSession } from '../session.js';



export function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // stockage indisponible (navigation privée)
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage plein ou indisponible : on ignore
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

// --- Bac à sable du visiteur (non connecté) ----------------------------------------------
const SANDBOX_KEY = 'salacv:sandbox';
const emptySandbox = () => ({ projects: {}, personas: {} });
function readSandbox() {
  try {
    const d = JSON.parse(localStorage.getItem(SANDBOX_KEY) || 'null');
    return d && typeof d === 'object' ? { projects: d.projects ?? {}, personas: d.personas ?? {} } : emptySandbox();
  } catch {
    return emptySandbox();
  }
}
// → vrai si c'est écrit (faux : stockage plein ou bloqué, navigation privée)
function writeSandbox(data) {
  try {
    if (!Object.keys(data.projects).length && !Object.keys(data.personas).length) localStorage.removeItem(SANDBOX_KEY);
    else localStorage.setItem(SANDBOX_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
// Un CV vide (ouvert puis laissé tel quel) ne vaut pas d'être gardé ni proposé.
const hasContent = (state) => {
  const r = toResume(normalizeState(state));
  return r.sections.length > 0 || Object.values(r.profile).some((v) => (Array.isArray(v) ? v.length : Boolean(v)));
};
let sandboxTimer = null;
function saveSandboxSoon() {
  clearTimeout(sandboxTimer);
  sandboxTimer = setTimeout(saveSandboxNow, 300);
}
function saveSandboxNow() {
  clearTimeout(sandboxTimer);
  sandboxTimer = null;
  const projects = Object.fromEntries(Object.entries(mem.projects).filter(([, p]) => hasContent(p.state)));
  sandboxOk = writeSandbox({ projects, personas: mem.personas });
  if (sandboxOk) emit('local');
  else window.dispatchEvent(new CustomEvent('salacv:save-refused', { detail: { error: 'Ce navigateur refuse de garder ton CV (stockage plein ou navigation privée). Connecte-toi pour le sauvegarder.' } }));
}

// --- Projets --------------------------------------------------------------------
// Copie en mémoire + synchronisation avec le serveur (compte connecté seulement).

// Connecté ? Le serveur le sait (cookie httpOnly) : la page n'a aucun jeton.
const loggedIn = () => Boolean(getSession());

const mem = { projects: {}, personas: {} };
let live = false; // connecté : chaque modification part au serveur
const dirty = new Map(); // « cv:id » | « persona:id » → { kind, id }
let timer = null;
let retry = null;

const emit = (state) => window.dispatchEvent(new CustomEvent('salacv:save', { detail: { state } }));
let sandboxOk = true; // visiteur : le dernier enregistrement dans le navigateur a réussi
export const isPersisted = () => live || sandboxOk;

async function call(body, { keepalive = false } = {}) {
  if (!loggedIn()) return { status: 401, data: { ok: false } };
  try {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive });
    return { status: res.status, data: await res.json().catch(() => ({ ok: false })) };
  } catch {
    return { status: 0, data: { ok: false, error: 'Pas de connexion.' } };
  }
}

const recordOf = (kind, id) => (kind === 'persona' ? mem.personas[id] : mem.projects[id]);

async function push(kind, id, opts) {
  const rec = recordOf(kind, id);
  if (!rec) return { status: 200, data: { ok: true } };
  return call({ action: 'save', id, kind, createdAt: rec.createdAt, data: rec }, opts);
}

function sessionExpired() {
  // session refusée par le serveur : on n'est plus connecté
  live = false;
  forgetSession();
  emit('local');
}

async function flush(opts = {}) {
  clearTimeout(timer);
  timer = null;
  if (!live || !dirty.size) return true;
  emit('saving');
  let ok = true;
  for (const [key, { kind, id }] of [...dirty]) {
    const { status, data } = await push(kind, id, opts);
    if (data.ok) dirty.delete(key);
    else if (status === 401) return sessionExpired(), false;
    else if (status === 400 || status === 413 || status === 503) {
      dirty.delete(key); // refus définitif (trop lourd, limite atteinte, stockage non configuré…) : inutile de réessayer
      window.dispatchEvent(new CustomEvent('salacv:save-refused', { detail: { error: data.error } }));
      ok = false;
    } else ok = false;
  }
  if (ok && !dirty.size) emit('saved');
  else if (!dirty.size) emit('refused');
  else {
    emit('error');
    clearTimeout(retry);
    retry = setTimeout(() => flush(), 6000);
  }
  return ok;
}

function schedule(kind, id) {
  if (!live) return saveSandboxSoon();
  dirty.set(`${kind}:${id}`, { kind, id });
  emit('saving');
  clearTimeout(timer);
  timer = setTimeout(() => flush(), 1000);
}

// Quitter la page : on envoie ce qui reste (keepalive limité à ~64 Ko : au-delà, envoi normal).
const flushOnLeave = () => {
  if (!live) return sandboxTimer && saveSandboxNow();
  if (!dirty.size) return;
  const small = [...dirty.values()].every(({ kind, id }) => JSON.stringify(recordOf(kind, id) ?? {}).length < 55_000);
  flush({ keepalive: small });
};
window.addEventListener('pagehide', flushOnLeave);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushOnLeave());

// À appeler au démarrage de chaque page (avant d'utiliser les projets).
export async function initStore() {
  mem.projects = {};
  mem.personas = {};
  dirty.clear();
  live = loggedIn();
  if (!live) {
    Object.assign(mem, readSandbox()); // visiteur : son bac à sable
    return { live: false };
  }
  const { status, data } = await call({ action: 'list' });
  if (status === 401) return sessionExpired(), { live: false, expired: true };
  if (!data.ok) return emit('error'), { live: true, offline: true };
  if (data.storage === false) window.dispatchEvent(new CustomEvent('salacv:save-refused', { detail: { error: 'Le stockage des CV n’est pas encore configuré par l’administrateur : tes CV ne peuvent pas être sauvegardés.' } }));
  for (const it of data.items) {
    const rec = { ...it.data, id: it.id, public: it.public, createdAt: it.createdAt, updatedAt: it.updatedAt };
    if (it.kind === 'persona') mem.personas[it.id] = rec;
    else mem.projects[it.id] = rec;
  }
  emit('saved');
  return { live: true };
}

const all = () => mem.projects;

export function listProjects() {
  return Object.values(all())
    .map((p) => ({ ...p, state: normalizeState(p.state) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  const p = all()[id];
  return p ? { ...p, state: normalizeState(p.state) } : null;
}

// patch.copy : { state, name, variants, docs } d'un CV partagé, dupliqué tel quel (nouveau CV, à soi).
export function createProject(patch = {}) {
  const persona = patch.persona ? getPersona(patch.persona) : null;
  const state = patch.copy ? normalizeState(structuredClone(patch.copy.state)) : persona ? fromPersona(persona) : emptyState();
  if (patch.name) state.profile.name = patch.name;
  if (patch.template) state.template = patch.template;
  const project = { id: newId(), state, createdAt: Date.now(), updatedAt: Date.now() };
  if (patch.copy) Object.assign(project, structuredClone({ name: patch.copy.name || undefined, variants: patch.copy.variants ?? {}, docs: patch.copy.docs ?? [] }));
  saveProject(project);
  return project;
}

export function saveProject(project) {
  mem.projects[project.id] = { ...project, updatedAt: Date.now() };
  schedule('cv', project.id);
}

export function deleteProject(id) {
  delete mem.projects[id];
  dirty.delete(`cv:${id}`);
  if (live) call({ action: 'delete', id });
  else saveSandboxNow();
}

// --- Partage ------------------------------------------------------------------------
// Un CV est privé. Son propriétaire (connecté) peut le rendre public : le lien /studio/?p=<id> s'ouvre alors chez
// n'importe qui, qui peut en faire sa propre copie. → { ok, error? }
export async function setShared(id, on) {
  if (!live) return { ok: false, error: 'Connecte-toi pour partager ce CV.' };
  await flush(); // le CV doit exister sur le serveur avant d'être partagé
  const { data } = await call({ action: 'share', id, public: Boolean(on) });
  if (data.ok && mem.projects[id]) mem.projects[id].public = Boolean(on);
  return data.ok ? { ok: true } : { ok: false, error: data.error || 'Le partage a échoué. Réessaie.' };
}
export const isShared = (id) => Boolean(mem.projects[id]?.public);
export const shareLink = (id) => `${location.origin}/studio/?p=${id}`;

// CV public de quelqu'un d'autre (sans connexion). → { state, name, variants, docs } | null
export async function fetchShared(id) {
  try {
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'public', id }) });
    const data = await res.json();
    return data.ok ? data.cv : null;
  } catch {
    return null;
  }
}

// --- Bac à sable → compte -------------------------------------------------------------
// CV faits sans compte sur ce navigateur, en attente (compte connecté seulement).
export function sandboxPending() {
  if (!live) return { projects: [], personas: [] };
  const s = readSandbox();
  return { projects: Object.values(s.projects).filter((p) => hasContent(p.state)), personas: Object.values(s.personas) };
}
// Ajoute le bac à sable au compte. Un identifiant déjà pris dans le compte reçoit un nouvel identifiant.
// → { moved, failed, ids: { ancien: nouveau }, error? }
export async function syncSandbox() {
  const s = readSandbox();
  const out = { moved: 0, failed: 0, ids: {}, error: '' };
  for (const [kind, bucket] of [['cv', 'projects'], ['persona', 'personas']]) {
    for (const rec of Object.values(s[bucket])) {
      const target = kind === 'cv' ? mem.projects : mem.personas;
      const id = target[rec.id] ? newId() : rec.id;
      target[id] = { ...rec, id, public: false };
      const { data } = await push(kind, id);
      if (data.ok) {
        out.moved++;
        out.ids[rec.id] = id;
        delete s[bucket][rec.id];
      } else {
        out.failed++;
        out.error ||= data.error || '';
        delete target[id]; // reste dans le bac à sable, pour réessayer plus tard
      }
    }
  }
  writeSandbox(s);
  return out;
}
export const discardSandbox = () => writeSandbox(emptySandbox());

export function duplicateProject(id) {
  const p = getProject(id);
  if (!p) return null;
  const copy = { id: newId(), state: structuredClone(p.state), createdAt: Date.now(), updatedAt: Date.now() };
  saveProject(copy);
  return copy;
}

// Nom affiché du CV : celui donné par l'étudiant, sinon « Nom — Profession ».
export function projectName(project) {
  const p = project.state.profile;
  return project.name?.trim() || [p.name.trim(), p.title.trim()].filter(Boolean).join(' — ') || 'CV sans titre';
}

// --- Offre Pro (cybers, secrétariats, recruteurs) ------------------------------------
// Local pendant la phase d'essai ; le wallet décidera quand il sera branché.
// Deux façons de travailler :
//  lite : l'étudiant qui veut un CV vite fait — un projet, un CV, l'aperçu d'abord ;
//  pro  : celui qui édite lui-même — un projet contient plusieurs CV et leurs langues.
export const PLANS = ['lite', 'pro'];
export const getPlan = () => (['pro', 'max'].includes(read('salacv:plan')) ? 'pro' : 'lite');
export const setPlan = (plan) => write('salacv:plan', PLANS.includes(plan) ? plan : 'lite');
export const isPro = () => getPlan() !== 'lite';
export const setPro = (on) => setPlan(on ? 'pro' : 'lite');

// --- Personnalités ------------------------------------------------------------------
// Une personnalité = tes informations de base (identité, contacts, photo, formation,
// expériences, compétences, langues, loisirs). Un nouveau CV part d'elle : tu changes
// seulement la profession et le profil (technicien ici, médecin là).

export function listPersonas() {
  return Object.values(mem.personas).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPersona(id) {
  return mem.personas[id] ?? null;
}

export function savePersona({ id, name, state }) {
  const persona = { id: id ?? newId(), name: name?.trim() || state.profile.name.trim() || 'Ma personnalité', state: normalizeState(structuredClone(state)), createdAt: mem.personas[id]?.createdAt ?? Date.now(), updatedAt: Date.now() };
  mem.personas[persona.id] = persona;
  schedule('persona', persona.id);
  return persona;
}

export function deletePersona(id) {
  delete mem.personas[id];
  dirty.delete(`persona:${id}`);
  if (live) call({ action: 'delete', id });
  else saveSandboxNow();
}

// Nouveau CV depuis une personnalité : tout est repris, sauf la profession et le profil.
export function fromPersona(persona) {
  const s = normalizeState(structuredClone(persona.state));
  s.profile.title = '';
  s.profile.summary = '';
  return s;
}

// --- Crédits -------------------------------------------------------------------
// Les crédits vivent sur le serveur (base de données), liés au compte : rien n'est gardé dans le navigateur,
// donc rien à modifier à la main. Visiteur non connecté : zéro crédit.

export const wallet = {
  // → { credits, history: [{ at, amount, reason }], loggedIn }
  async balance() {
    if (!loggedIn()) return { credits: 0, history: [], loggedIn: false };
    try {
      const res = await fetch('/api/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!data.ok) return { credits: 0, history: [], loggedIn: false };
      return { credits: data.balance, loggedIn: data.loggedIn, history: data.history.map((h) => ({ at: h.at, amount: h.delta, reason: h.reason })) };
    } catch {
      return { credits: 0, history: [], loggedIn: true, offline: true };
    }
  },
};

// --- Achat de crédits (LightPay) ----------------------------------------------
// Les prix viennent du serveur (fixés dans l'admin) ; le paiement se fait dans le dialogue LightPay
// (wallet LightPay ou mobile money). Le serveur crédite le compte quand LightPay confirme le paiement.

const post = async (route, body = {}) => {
  try {
    const res = await fetch(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, error: 'Pas de connexion. Réessaie.' };
  }
};

export const shop = {
  // → { open, checkoutUrl, test, packs: [{ id, credits, price, promoPrice }] }
  packs: () => post('shop'),
  // → { order, checkoutUrl, amount, credits }
  buy: (packId) => post('buy', { packId }),
  // → { order: { id, status: PENDING | PAID | EXPIRED | CANCELLED | FAILED, credits, amount }, balance }
  order: (orderId) => post('order', { orderId }),
};

// --- Parrainage et avis --------------------------------------------------------

// Lien à partager (sans code de parrainage : le parrainage côté serveur n'existe pas encore).
export function inviteLink() {
  return `${location.origin}/`;
}

// Avis (note + mot) : envoyé au serveur, qui l'enregistre pour tout le monde (connecté ou non) et l'ajoute aux statistiques.
export async function sendFeedback(stars, comment = '') {
  try {
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stars, comment }) });
    return await res.json();
  } catch {
    return { ok: false, error: 'Pas de connexion. Ton avis n’a pas pu être envoyé.' };
  }
}

export function relativeDate(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.round(diff / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
