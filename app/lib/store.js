// Données locales de l'utilisateur : projets (CV enregistrés), crédits, parrainage, avis.
// Tout est dans le navigateur pour l'instant. Le wallet est derrière une interface
// asynchrone (balance / spend) : le jour où le wallet interne est branché, seul cet
// objet change, les pages ne bougent pas.
import { emptyState, normalizeState } from '../state.js';

const PROJECTS_KEY = 'salacv:projects:v1';
const LEGACY_DRAFT_KEY = 'salacv:form:v2';
const WALLET_KEY = 'salacv:wallet:v1';
const REF_KEY = 'salacv:ref';
const REFERRED_KEY = 'salacv:referred-by';
const RATING_KEY = 'salacv:rating';
const PERSONAS_KEY = 'salacv:personas:v1';

export const WEEKLY_CREDITS = 5;
export const PDF_COST = 1;

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

const json = (key, fallback) => {
  try {
    return JSON.parse(read(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const newId = () => Math.random().toString(36).slice(2, 10);

// --- Projets -------------------------------------------------------------------

function all() {
  const projects = json(PROJECTS_KEY, {});
  // Ancien brouillon unique (avant le dashboard) : devient le premier projet.
  const legacy = read(LEGACY_DRAFT_KEY);
  if (legacy) {
    try {
      const id = newId();
      projects[id] = { id, state: normalizeState(JSON.parse(legacy)), createdAt: Date.now(), updatedAt: Date.now() };
      write(PROJECTS_KEY, JSON.stringify(projects));
    } catch {}
    try {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    } catch {}
  }
  return projects;
}

export function listProjects() {
  return Object.values(all())
    .map((p) => ({ ...p, state: normalizeState(p.state) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  const p = all()[id];
  return p ? { ...p, state: normalizeState(p.state) } : null;
}

export function createProject(patch = {}) {
  const persona = patch.persona ? getPersona(patch.persona) : null;
  const state = persona ? fromPersona(persona) : emptyState();
  if (patch.name) state.profile.name = patch.name;
  if (patch.template) state.template = patch.template;
  const project = { id: newId(), state, createdAt: Date.now(), updatedAt: Date.now() };
  saveProject(project);
  return project;
}

export function saveProject(project) {
  const projects = all();
  projects[project.id] = { ...project, updatedAt: Date.now() };
  write(PROJECTS_KEY, JSON.stringify(projects));
}

export function deleteProject(id) {
  const projects = all();
  delete projects[id];
  write(PROJECTS_KEY, JSON.stringify(projects));
}

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
// Trois façons de travailler :
//  lite : l'étudiant qui veut un CV vite fait — un projet, un CV, l'aperçu d'abord ;
//  pro  : celui qui édite lui-même — un projet contient plusieurs CV et leurs langues ;
//  max  : le God mode — tout est ouvert : tous les projets dans le même espace.
export const PLANS = ['lite', 'pro', 'max'];
export const getPlan = () => ({ pro: 'pro', max: 'max' })[read('salacv:plan')] ?? 'lite';
export const setPlan = (plan) => write('salacv:plan', PLANS.includes(plan) ? plan : 'lite');
export const isPro = () => getPlan() !== 'lite';
export const setPro = (on) => setPlan(on ? 'pro' : 'lite');

// --- Personnalités ------------------------------------------------------------------
// Une personnalité = tes informations de base (identité, contacts, photo, formation,
// expériences, compétences, langues, loisirs). Un nouveau CV part d'elle : tu changes
// seulement la profession et le profil (technicien ici, médecin là).

export function listPersonas() {
  return Object.values(json(PERSONAS_KEY, {})).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPersona(id) {
  return json(PERSONAS_KEY, {})[id] ?? null;
}

export function savePersona({ id, name, state }) {
  const all = json(PERSONAS_KEY, {});
  const persona = { id: id ?? newId(), name: name?.trim() || state.profile.name.trim() || 'Ma personnalité', state: normalizeState(structuredClone(state)), createdAt: all[id]?.createdAt ?? Date.now(), updatedAt: Date.now() };
  all[persona.id] = persona;
  write(PERSONAS_KEY, JSON.stringify(all));
  return persona;
}

export function deletePersona(id) {
  const all = json(PERSONAS_KEY, {});
  delete all[id];
  write(PERSONAS_KEY, JSON.stringify(all));
}

// Nouveau CV depuis une personnalité : tout est repris, sauf la profession et le profil.
export function fromPersona(persona) {
  const s = normalizeState(structuredClone(persona.state));
  s.profile.title = '';
  s.profile.summary = '';
  return s;
}

// --- Crédits -------------------------------------------------------------------
// Les crédits repartent à WEEKLY_CREDITS chaque dimanche à 00:00 (heure locale).

export function lastSunday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function nextReset(now = new Date()) {
  const d = lastSunday(now);
  d.setDate(d.getDate() + 7);
  return d;
}

function walletState() {
  const w = json(WALLET_KEY, null);
  const sunday = lastSunday().getTime();
  if (!w || w.resetAt < sunday) {
    const fresh = { credits: WEEKLY_CREDITS, resetAt: sunday, history: w?.history ?? [], paid: w?.paid ?? {} };
    write(WALLET_KEY, JSON.stringify(fresh));
    return fresh;
  }
  return w;
}

export const wallet = {
  async balance() {
    const w = walletState();
    return { credits: w.credits, weekly: WEEKLY_CREDITS, nextReset: nextReset(), history: w.history.slice(-20).reverse() };
  },
  // Déjà payé : le même contenu se re-télécharge sans débiter (clé = empreinte du CV).
  async isPaid(key) {
    return Boolean(walletState().paid[key]);
  },
  async spend(amount, { reason, key }) {
    const w = walletState();
    if (key && w.paid[key]) return { ok: true, credits: w.credits, free: true };
    if (w.credits < amount) return { ok: false, credits: w.credits };
    w.credits -= amount;
    w.history.push({ at: Date.now(), amount: -amount, reason });
    if (key) w.paid[key] = Date.now();
    // Les empreintes anciennes ne servent plus : on n'en garde que 50.
    const keys = Object.keys(w.paid);
    if (keys.length > 50) for (const k of keys.sort((a, b) => w.paid[a] - w.paid[b]).slice(0, keys.length - 50)) delete w.paid[k];
    write(WALLET_KEY, JSON.stringify(w));
    return { ok: true, credits: w.credits };
  },
};

// Empreinte d'un texte (FNV-1a) : identifie une version de CV déjà payée.
export function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// --- Parrainage et avis --------------------------------------------------------

export function referralCode() {
  let code = read(REF_KEY);
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
    write(REF_KEY, code);
  }
  return code;
}

export function inviteLink() {
  return `${location.origin}/?ref=${referralCode()}`;
}

// Sur la landing : garde le code de l'ami qui a invité (crédité au branchement du wallet).
export function captureReferral() {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[A-Z0-9]{4,12}$/.test(ref) && ref !== read(REF_KEY) && !read(REFERRED_KEY)) write(REFERRED_KEY, ref);
}

export function rating() {
  return json(RATING_KEY, null);
}

export function saveRating(stars, comment = '') {
  write(RATING_KEY, JSON.stringify({ stars, comment, at: Date.now() }));
}

export function relativeDate(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.round(diff / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
