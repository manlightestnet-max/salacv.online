// Interface d'administration : utilisateurs (blocage), CV de la phase d'essai, ressources
// (métiers, établissements, entreprises…) et skills de l'agent.
//
//   POST /api/admin { action, ... }   (Authorization: Bearer <jeton admin> sauf pour « login »)
//
// Accès : mot de passe SALACV_ADMIN_PASSWORD (variable d'environnement). Sans elle, l'admin
// est fermée. Le jeton admin a l'utilisateur réservé « #admin » (impossible pour un étudiant).
import { timingSafeEqual } from 'node:crypto';
import { issue, verify } from './agent/auth.js';
import { SKILLS } from './agent/skills/index.js';
import { store } from './store.js';

export const ADMIN = '#admin';
export const MAX_CVS = 2000;
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// --- Utilisateurs ---------------------------------------------------------------------

export async function recordLogin(username) {
  const s = store();
  const users = await s.get('users', {});
  const now = Date.now();
  const u = (users[username] ??= { first: now, logins: 0 });
  if (u.blocked) return { blocked: true };
  u.last = now;
  u.logins += 1;
  await s.set('users', users);
  return { blocked: false };
}

export async function isBlocked(username) {
  return Boolean((await store().get('users', {}))[username]?.blocked);
}

// --- CV de la phase d'essai --------------------------------------------------------------
// Conservés sans photo, pour améliorer l'application (annoncé à l'étudiant avant de générer).
export async function collect(resume, username) {
  if (!resume || typeof resume !== 'object' || !resume.profile?.name) return;
  const { photo, ...profile } = resume.profile;
  await store().push('cvs', { at: Date.now(), username: username ?? null, resume: { ...resume, profile } }, MAX_CVS);
}

// --- Skills ajoutées par l'admin (en plus de celles du code) ------------------------------
export async function customSkills() {
  try {
    return await store().get('skills', []);
  } catch {
    return []; // stockage indisponible : l'agent garde ses skills du code
  }
}

// --- Route ------------------------------------------------------------------------------

export async function admin(payload, token, env = process.env) {
  const action = String(payload?.action ?? '');
  if (action === 'login') {
    if (!env.SALACV_ADMIN_PASSWORD) return [503, { ok: false, error: 'Admin fermée : définis SALACV_ADMIN_PASSWORD.' }];
    if (!same(payload.password ?? '', env.SALACV_ADMIN_PASSWORD)) return [401, { ok: false, error: 'Mot de passe incorrect.' }];
    const t = issue(ADMIN, env);
    return t ? [200, { ok: true, token: t }] : [503, { ok: false, error: 'Clé de signature absente (OLLAMA_API_KEY ou SALACV_SESSION_SECRET).' }];
  }
  if (!env.SALACV_ADMIN_PASSWORD || verify(token, env) !== ADMIN) return [401, { ok: false, error: 'Connexion admin requise.' }];

  const s = store(env);
  switch (action) {
    case 'overview': {
      const users = await s.get('users', {});
      const cvs = await s.range('cvs', MAX_CVS);
      const resources = await s.get('resources', null);
      return [200, { ok: true, durable: s.durable, users: Object.keys(users).length, blocked: Object.values(users).filter((u) => u.blocked).length, cvs: cvs.length, resources: resources ? counts(resources) : null, skills: (await s.get('skills', [])).length }];
    }
    case 'users': {
      const users = await s.get('users', {});
      return [200, { ok: true, users: Object.entries(users).map(([username, u]) => ({ username, ...u })).sort((a, b) => (b.last ?? 0) - (a.last ?? 0)) }];
    }
    case 'block':
    case 'unblock': {
      const users = await s.get('users', {});
      const name = String(payload.username ?? '');
      if (!users[name]) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      users[name].blocked = action === 'block';
      users[name].reason = action === 'block' ? String(payload.reason ?? '').slice(0, 200) : undefined;
      await s.set('users', users);
      return [200, { ok: true }];
    }
    case 'cvs':
      return [200, { ok: true, cvs: await s.range('cvs', Math.min(Number(payload.limit) || 200, MAX_CVS)) }];
    case 'resources':
      return [200, { ok: true, resources: await s.get('resources', null) }];
    case 'setResources': {
      const r = payload.resources;
      const error = checkResources(r);
      if (error) return [400, { ok: false, error }];
      await s.set('resources', { ...r, updatedAt: Date.now() });
      return [200, { ok: true, counts: counts(r) }];
    }
    case 'skills':
      return [200, { ok: true, builtin: SKILLS.map(({ slug, title, description }) => ({ slug, title, description })), custom: await s.get('skills', []) }];
    case 'saveSkill': {
      const k = payload.skill ?? {};
      const skill = { slug: String(k.slug ?? '').trim(), title: String(k.title ?? '').trim().slice(0, 80), description: String(k.description ?? '').trim().slice(0, 300), content: String(k.content ?? '').slice(0, 20000) };
      if (!SLUG.test(skill.slug)) return [400, { ok: false, error: 'Slug : lettres minuscules, chiffres et tirets.' }];
      if (SKILLS.some((b) => b.slug === skill.slug)) return [400, { ok: false, error: 'Ce slug appartient à une skill du code.' }];
      if (!skill.title || !skill.content.trim()) return [400, { ok: false, error: 'Titre et contenu obligatoires.' }];
      const list = (await s.get('skills', [])).filter((x) => x.slug !== skill.slug);
      await s.set('skills', [...list, { ...skill, updatedAt: Date.now() }]);
      return [200, { ok: true }];
    }
    case 'deleteSkill': {
      await s.set('skills', (await s.get('skills', [])).filter((x) => x.slug !== payload.slug));
      return [200, { ok: true }];
    }
    default:
      return [400, { ok: false, error: 'Action inconnue.' }];
  }
}

const LISTS = ['metiers', 'domaines', 'etablissements', 'entreprises'];

function counts(r) {
  return Object.fromEntries(LISTS.map((k) => [k, Array.isArray(r?.[k]) ? r[k].length : 0]));
}

// Le JSON de recherche (prompt Gemini) : listes d'objets, 200 éléments max chacune.
export function checkResources(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'JSON attendu : un objet { metiers, domaines, etablissements, entreprises, structure_cv }.';
  if (!LISTS.some((k) => Array.isArray(r[k]))) return 'Aucune liste reconnue (metiers, domaines, etablissements, entreprises).';
  for (const k of LISTS) {
    if (r[k] == null) continue;
    if (!Array.isArray(r[k])) return `« ${k} » doit être une liste.`;
    if (r[k].length > 200) return `« ${k} » : 200 éléments maximum (${r[k].length}).`;
    if (!r[k].every((x) => x && typeof x === 'object')) return `« ${k} » : chaque élément doit être un objet.`;
  }
  return null;
}
