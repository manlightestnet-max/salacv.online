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
import SEED from '../resources/congo-brazzaville.json' with { type: 'json' };

// Ressources de départ (recherche Congo-Brazzaville, dans le repo) tant que l'admin n'a rien
// enregistré : l'interface les montre tout de suite, on ajoute / supprime à partir d'elles.
export const seedResources = () => structuredClone(SEED);
const loadResources = async (s) => (await s.get('resources', null)) ?? seedResources();

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

// --- Journal des actions de l'admin --------------------------------------------------------
const MAX_JOURNAL = 500;
const log = (title, detail = '') => store().push('journal', { at: Date.now(), title, detail }, MAX_JOURNAL).catch(() => {});

// --- Route ------------------------------------------------------------------------------

export async function admin(payload, token, env = process.env) {
  const action = String(payload?.action ?? '');
  if (action === 'login') {
    if (!env.SALACV_ADMIN_PASSWORD) return [503, { ok: false, error: 'Admin fermée : définis SALACV_ADMIN_PASSWORD.' }];
    if (!same(payload.password ?? '', env.SALACV_ADMIN_PASSWORD)) return [401, { ok: false, error: 'Mot de passe incorrect.' }];
    const t = issue(ADMIN, env);
    if (t) await log('Connexion admin');
    return t ? [200, { ok: true, token: t }] : [503, { ok: false, error: 'Clé de signature absente (OLLAMA_API_KEY ou SALACV_SESSION_SECRET).' }];
  }
  if (!env.SALACV_ADMIN_PASSWORD || verify(token, env) !== ADMIN) return [401, { ok: false, error: 'Connexion admin requise.' }];

  const s = store(env);
  switch (action) {
    case 'overview': {
      const users = Object.values(await s.get('users', {}));
      const cvs = await s.range('cvs', MAX_CVS);
      const resources = await loadResources(s);
      const week = Date.now() - 7 * 86400000;
      const today = new Date().setHours(0, 0, 0, 0);
      return [
        200,
        {
          ok: true,
          durable: s.durable,
          users: users.length,
          blocked: users.filter((u) => u.blocked).length,
          active7: users.filter((u) => (u.last ?? 0) >= week).length,
          new7: users.filter((u) => u.first >= week).length,
          cvs: cvs.length,
          cvsToday: cvs.filter((c) => c.at >= today).length,
          cvs7: cvs.filter((c) => c.at >= week).length,
          resources: resources ? counts(resources) : null,
          skills: (await s.get('skills', [])).length,
          journal: await s.range('journal', 6),
        },
      ];
    }
    case 'journal':
      return [200, { ok: true, journal: await s.range('journal', MAX_JOURNAL) }];
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
      await log(action === 'block' ? 'Compte bloqué' : 'Compte débloqué', name + (users[name].reason ? ` · ${users[name].reason}` : ''));
      return [200, { ok: true }];
    }
    case 'cvs':
      return [200, { ok: true, cvs: await s.range('cvs', Math.min(Number(payload.limit) || 200, MAX_CVS)) }];
    case 'templates':
      return [200, { ok: true, templates: await s.get('templates', {}) }];
    case 'setTemplate': {
      const id = String(payload.id ?? '');
      if (!/^[a-z0-9-]{1,40}$/.test(id)) return [400, { ok: false, error: 'Modèle inconnu.' }];
      const audience = AUDIENCES.includes(payload.audience) ? payload.audience : 'all';
      const all = await s.get('templates', {});
      all[id] = { enabled: payload.enabled !== false, audience };
      await s.set('templates', all);
      log(`Modèle ${id}`, `${all[id].enabled ? 'disponible' : 'indisponible'} · ${audience}`);
      return [200, { ok: true, templates: all }];
    }
    case 'resources':
      return [200, { ok: true, resources: await loadResources(s) }];
    case 'setResources': {
      const r = payload.resources;
      const error = checkResources(r);
      if (error) return [400, { ok: false, error }];
      await s.set('resources', { ...r, updatedAt: Date.now() });
      await log('Ressources importées', Object.entries(counts(r)).map(([k, n]) => `${n} ${k}`).join(' · '));
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
      await log('Skill enregistrée', `${skill.title} · ${skill.slug}`);
      return [200, { ok: true }];
    }
    case 'deleteSkill': {
      await s.set('skills', (await s.get('skills', [])).filter((x) => x.slug !== payload.slug));
      await log('Skill supprimée', String(payload.slug ?? ''));
      return [200, { ok: true }];
    }
    default:
      return [400, { ok: false, error: 'Action inconnue.' }];
  }
}

// Modèles de CV : disponible ou non, et pour qui (tous, Lite, Pro).
const AUDIENCES = ['all', 'lite', 'pro'];
export async function templateSettings() {
  return [200, { ok: true, templates: await store().get('templates', {}) }];
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
