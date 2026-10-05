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
import { getUser, listUsers, setAiAccess, setBlocked, userStats } from './db/users.js';
import * as pool from './keys/pool.js';
import { SecretsError } from './crypto.js';
import { listSettings, setSetting, DEFINITIONS } from './settings.js';
import { parseTemplateSpec } from '../src/templates/spec.js';
import { BUILTIN_SPECS } from '../src/templates/congo.js';
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
  try {
    return await adminRoute(payload, token, env);
  } catch (err) {
    if (err instanceof pool.KeyError || err instanceof SecretsError) return [400, { ok: false, error: err.message }];
    throw err;
  }
}

async function adminRoute(payload, token, env) {
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
      const stats = await userStats();
      const cvs = await s.range('cvs', MAX_CVS);
      const resources = await loadResources(s);
      const week = Date.now() - 7 * 86400000;
      const today = new Date().setHours(0, 0, 0, 0);
      return [
        200,
        {
          ok: true,
          durable: s.durable,
          users: stats.users,
          blocked: stats.blocked,
          active7: stats.active7,
          new7: stats.new7,
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
    case 'users':
      return [200, { ok: true, users: await listUsers() }];
    case 'block':
    case 'unblock': {
      const name = String(payload.username ?? '');
      if (!(await setBlocked(name, action === 'block', payload.reason))) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      await log(action === 'block' ? 'Compte bloqué' : 'Compte débloqué', name + (action === 'block' && payload.reason ? ` · ${String(payload.reason).slice(0, 200)}` : ''));
      return [200, { ok: true }];
    }
    // Accès à l'IA : accordé à la connexion, retirable (ou rendu) ici.
    case 'setAi': {
      const name = String(payload.username ?? '');
      if (!(await setAiAccess(name, payload.allowed !== false))) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      await log(payload.allowed === false ? 'Accès IA retiré' : 'Accès IA accordé', name);
      return [200, { ok: true }];
    }

    // --- Clés des fournisseurs IA : pool partagé, attribution à un utilisateur, réglages -------
    case 'keys':
      return [200, { ok: true, keys: await pool.listKeys(), providers: pool.providers(), settings: await listSettings(env), users: (await listUsers()).map((u) => u.username) }];
    case 'addKey': {
      const owner = payload.owner ? String(payload.owner) : null;
      if (owner && !(await getUser(owner))) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      const key = await pool.addKey({ provider: String(payload.provider ?? ''), secret: payload.key, label: payload.label, owner, createdBy: ADMIN }, env);
      await log(owner ? 'Clé IA attribuée' : 'Clé IA ajoutée au pool', `${key.provider} …${key.last4}${owner ? ` → ${owner}` : ''}`);
      return [200, { ok: true, key }];
    }
    case 'assignKey': {
      const owner = payload.username ? String(payload.username) : null;
      if (owner && !(await getUser(owner))) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      const key = await pool.assignKey(Number(payload.id), owner);
      await log(owner ? 'Clé IA attribuée' : 'Clé IA remise dans le pool', `${key.provider} …${key.last4}${owner ? ` → ${owner}` : ''}`);
      return [200, { ok: true, key }];
    }
    case 'setKeyDisabled':
      await pool.setKeyDisabled(Number(payload.id), payload.disabled !== false, 'désactivée par l’admin');
      await log(payload.disabled === false ? 'Clé IA réactivée' : 'Clé IA désactivée', `#${Number(payload.id)}`);
      return [200, { ok: true }];
    case 'deleteKey':
      await pool.deleteKey(Number(payload.id));
      await log('Clé IA supprimée', `#${Number(payload.id)}`);
      return [200, { ok: true }];
    case 'settings':
      return [200, { ok: true, settings: await listSettings(env) }];
    case 'setSetting': {
      const key = String(payload.key ?? '');
      if (!DEFINITIONS[key]) return [400, { ok: false, error: 'Réglage inconnu.' }];
      await setSetting(key, payload.value, env);
      await log('Réglage modifié', DEFINITIONS[key].secret ? `${key} (secret)` : `${key} = ${String(payload.value).slice(0, 80)}`);
      return [200, { ok: true, settings: await listSettings(env) }];
    }
    case 'cvs':
      return [200, { ok: true, cvs: await s.range('cvs', Math.min(Number(payload.limit) || 200, MAX_CVS)) }];
    case 'templates':
      return [200, { ok: true, templates: await s.get('templates', {}), specs: await s.get('templateSpecs', []) }];
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
    // Modèles écrits dans le DSL (JSON), téléversés ici : ajouter / remplacer, supprimer.
    case 'saveTemplateSpec': {
      const r = parseTemplateSpec(payload.spec);
      if (!r.ok) return [400, { ok: false, error: r.error }];
      if (BUILTIN_IDS.has(r.spec.id)) return [400, { ok: false, error: `« ${r.spec.id} » est un modèle intégré : choisis un autre id.` }];
      const specs = (await s.get('templateSpecs', [])).filter((x) => x.id !== r.spec.id);
      if (specs.length >= 60) return [400, { ok: false, error: '60 modèles téléversés maximum.' }];
      specs.push(r.spec);
      await s.set('templateSpecs', specs);
      log(`Modèle téléversé : ${r.spec.name}`, r.spec.id);
      return [200, { ok: true, specs }];
    }
    case 'deleteTemplateSpec': {
      const specs = (await s.get('templateSpecs', [])).filter((x) => x.id !== payload.id);
      await s.set('templateSpecs', specs);
      log('Modèle supprimé', String(payload.id));
      return [200, { ok: true, specs }];
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
const BUILTIN_IDS = new Set(['minimal', 'bandeau', 'vitae', 'diagonale', 'epure', 'marine', 'contraste', ...BUILTIN_SPECS.map((x) => x.id)]);
export async function templateSettings() {
  const s = store();
  return [200, { ok: true, templates: await s.get('templates', {}), specs: await s.get('templateSpecs', []) }];
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
