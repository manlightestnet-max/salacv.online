// Interface d'administration : utilisateurs (blocage), CV de la phase d'essai, ressources
// (métiers, établissements, entreprises…) et skills de l'agent.
//
//   POST /api/admin { action, ... }   (Authorization: Bearer <jeton admin> sauf pour « login »)
//
// Accès : UNIQUEMENT par compte Google. Le navigateur donne un jeton Firebase, le serveur le vérifie puis compare
// l'identifiant Firebase (UID) du compte à SALACV_ADMIN_UID (secret d'environnement ; plusieurs UID séparés par des
// virgules). Sans cette variable, l'admin est fermée. Le jeton admin a l'utilisateur réservé « #admin ».
import { timingSafeEqual } from 'node:crypto';
import { issue, verify } from './agent/auth.js';
import { SKILLS } from './agent/skills/index.js';
import { store } from './store.js';
import { getUser, listUsers, setAiAccess, setBlocked, userStats } from './db/users.js';
import * as pool from './keys/pool.js';
import { SecretsError } from './crypto.js';
import { verifyFirebaseIdToken } from './accounts/firebase.js';
import { RateLimiter } from './ratelimit.js';
import { RecoveryError, recoverMaster, recoveryStatus, saveRecovery } from './recovery.js';
import { listSettings, setSetting, DEFINITIONS } from './settings.js';
import { r2Configured } from './r2.js';
import { db } from './db/index.js';
import { getSetting } from './settings.js';
import { checkPacks, connectFinish, connectStart, lightpayConfig, listPacks, recentOrders, salesStats, savePacks } from './shop.js';
import { adminSetAi, allowances, checkAiPacks, listAiPacks, saveAiPacks } from './aiquota.js';
import { CONTACT_KEYS, checkContact } from './contact.js';
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

export async function admin(payload, token, env = process.env, opts = {}) {
  try {
    return await adminRoute(payload, token, env, opts);
  } catch (err) {
    if (err instanceof pool.KeyError || err instanceof SecretsError) return [400, { ok: false, error: err.message }];
    throw err;
  }
}

const ADMIN_TTL = 8 * 3600; // une session admin dure 8 heures
const adminLoginLimiter = new RateLimiter(10);
// Phrase de récupération : peu d'essais par minute (chaque essai coûte un scrypt).
const recoveryLimiter = new RateLimiter(5);

// Les UID Firebase autorisés (SALACV_ADMIN_UID), comparés en temps constant.
const isAdminUid = (uid, env) =>
  String(env.SALACV_ADMIN_UID ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .reduce((found, allowed) => same(uid, allowed) || found, false);

// Connexion Google ordinaire (/api/google) d'un compte administrateur : même preuve que « login » (jeton Google
// vérifié, UID autorisé), donc la session admin s'ouvre en même temps. null si ce n'est pas un administrateur.
export async function adminTokenFor(identity, env = process.env) {
  if (!identity?.uid || !String(env.SALACV_ADMIN_UID ?? '').trim() || !isAdminUid(identity.uid, env)) return null;
  const t = issue(ADMIN, env, Date.now(), ADMIN_TTL);
  if (t) await log('Connexion admin', identity.email);
  return t;
}
export const ADMIN_SECONDS = ADMIN_TTL;

async function adminRoute(payload, token, env, { verifyToken = verifyFirebaseIdToken } = {}) {
  const action = String(payload?.action ?? '');
  if (action === 'login') {
    if (!String(env.SALACV_ADMIN_UID ?? '').trim()) return [503, { ok: false, error: 'Admin fermée : définis SALACV_ADMIN_UID (l’UID Firebase de l’administrateur).' }];
    if (!adminLoginLimiter.allow('admin')) return [429, { ok: false, error: 'Trop de tentatives. Attends une minute.' }];
    const identity = await verifyToken(payload.idToken, env);
    if (!identity) return [401, { ok: false, error: 'Connexion Google refusée. Réessaie.' }];
    if (!isAdminUid(identity.uid, env)) {
      await log('Tentative de connexion admin refusée', identity.email).catch(() => {});
      return [403, { ok: false, error: 'Ce compte Google n’est pas administrateur.' }];
    }
    const t = issue(ADMIN, env, Date.now(), ADMIN_TTL);
    if (t) await log('Connexion admin', identity.email);
    return t ? [200, { ok: true, token: t, email: identity.email }] : [503, { ok: false, error: 'Serveur non configuré : la variable SALACV_MASTER_KEY est absente ou invalide (32 octets en base64). Ouvre /api/status pour voir ce qui manque.' }];
  }
  if (!String(env.SALACV_ADMIN_UID ?? '').trim() || verify(token, env) !== ADMIN) return [401, { ok: false, error: 'Connexion admin requise.' }];
  if (action === 'session') return [200, { ok: true }]; // la page /auth/?admin=1 vérifie qu'une session admin est déjà ouverte

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
    case 'whoami':
      return [200, { ok: true }];
    // Ce qui est prêt et ce qui manque : tout se règle dans cette interface, sauf les secrets de démarrage.
    case 'setup': {
      const keys = await pool.listKeys();
      const usable = keys.filter((k) => !k.disabled);
      return [
        200,
        {
          ok: true,
          checks: [
            { id: 'db', label: 'Base de données', ok: true, detail: (await db()).kind === 'neon' ? 'Neon connectée' : 'Base locale (développement) : définis DATABASE_URL pour Neon', env: 'DATABASE_URL' },
            { id: 'master', label: 'Clé maître (chiffre les secrets, signe les sessions)', ok: Boolean(env.SALACV_MASTER_KEY), detail: env.SALACV_MASTER_KEY ? 'Définie' : 'Absente : variable SALACV_MASTER_KEY (32 octets, base64)', env: 'SALACV_MASTER_KEY' },
            { id: 'admin', label: 'Administrateur', ok: Boolean(String(env.SALACV_ADMIN_UID ?? '').trim()), detail: 'UID Firebase du compte admin', env: 'SALACV_ADMIN_UID' },
            { id: 'firebase', label: 'Connexion Google (clé Firebase)', ok: Boolean(await getSetting('firebase.apiKey', env)), detail: 'À renseigner dans « Clés IA » → Connexion Google', env: null },
            { id: 'ai', label: 'Clés IA', ok: usable.length > 0, detail: `${usable.length} utilisable${usable.length > 1 ? 's' : ''}, dont ${usable.filter((k) => k.public).length} publique${usable.filter((k) => k.public).length > 1 ? 's' : ''} (visiteurs)`, env: null },
            { id: 'r2', label: 'Stockage R2 (CV et PDF des clients)', ok: await r2Configured(env), detail: 'Obligatoire : sans lui, les comptes ne peuvent pas sauvegarder leurs CV', env: null },
          ],
        },
      ];
    }
    case 'users': {
      const reserve = await allowances(env);
      return [200, { ok: true, users: (await listUsers()).map((u) => ({ ...u, ai: reserve[u.username] ?? null })), userTokens: await getSetting('ai.userTokens', env) }];
    }
    case 'setUserAi': {
      const name = String(payload.username ?? '');
      if (!(await getUser(name))) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      const r = await adminSetAi(name, { reset: payload.reset === true, customLimit: payload.customLimit, addTokens: payload.addTokens });
      if (!r.ok) return [400, r];
      await log('IA d’un compte modifiée', `${name}${payload.reset ? ' · remise à zéro' : ''}${payload.customLimit !== undefined ? ` · plafond ${payload.customLimit === null || payload.customLimit === '' ? 'général' : payload.customLimit}` : ''}${payload.addTokens ? ` · +${payload.addTokens} tokens` : ''}`);
      return [200, { ok: true }];
    }
    case 'ai':
      return [200, { ok: true, aiPacks: await listAiPacks(), settings: (await listSettings(env)).filter((x) => x.key.startsWith('ai.')) }];
    case 'contact':
      return [200, { ok: true, settings: (await listSettings(env)).filter((x) => CONTACT_KEYS.includes(x.key)) }];
    case 'saveContact': {
      // Tout ou rien : un champ invalide, rien n'est enregistré (le message dit lequel).
      const values = {};
      for (const key of CONTACT_KEYS) {
        const r = checkContact(key, payload.values?.[key]);
        if (!r.ok) return [400, { ok: false, error: r.error, field: key }];
        values[key] = r.value;
      }
      for (const key of CONTACT_KEYS) await setSetting(key, values[key], env);
      await log('Coordonnées modifiées', CONTACT_KEYS.map((k) => `${k.slice(8)} ${values[k] ? 'renseigné' : 'vide'}`).join(' · '));
      return [200, { ok: true, settings: (await listSettings(env)).filter((x) => CONTACT_KEYS.includes(x.key)) }];
    }
    case 'saveAiPacks': {
      const r = checkAiPacks(payload.packs);
      if (!r.ok) return [400, { ok: false, error: r.error }];
      await saveAiPacks(r.packs);
      await log('Packs IA modifiés', r.packs.map((p) => `${p.name} : ${p.tokens} tokens, ${p.credits} cr.${p.days ? `, ${p.days} j` : ''}${p.active ? '' : ' (retiré)'}`).join(' · ') || 'aucun');
      return [200, { ok: true, packs: r.packs }];
    }
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
      return [200, { ok: true, r2: await r2Configured(env), keys: await pool.listKeys({ env }), providers: pool.providers(), settings: await listSettings(env), users: (await listUsers()).map((u) => u.username), recovery: await recoveryStatus(env) }];
    // --- Phrase de récupération de la clé maîtresse ----------------------------------------------
    case 'saveRecovery': {
      if (String(payload.passphrase ?? '') !== String(payload.confirm ?? '')) return [400, { ok: false, error: 'Les deux phrases ne sont pas identiques.' }];
      try {
        const recovery = await saveRecovery(payload.passphrase, env);
        await log('Phrase de récupération enregistrée', 'copie chiffrée de la clé maîtresse mise à jour');
        return [200, { ok: true, recovery }];
      } catch (err) {
        if (err instanceof RecoveryError) return [400, { ok: false, error: err.message }];
        throw err;
      }
    }
    case 'recoverMaster': {
      if (!recoveryLimiter.allow('admin')) return [429, { ok: false, error: 'Trop d’essais. Attends une minute.' }];
      try {
        const keys = await recoverMaster(String(payload.passphrase ?? ''));
        await log('Clé maîtresse récupérée', 'avec la phrase de récupération');
        return [200, { ok: true, ...keys }];
      } catch (err) {
        if (err instanceof RecoveryError) {
          await log('Récupération refusée', err.message);
          return [400, { ok: false, error: err.message }];
        }
        throw err;
      }
    }
    case 'addKey': {
      const owner = payload.owner ? String(payload.owner) : null;
      if (owner && !(await getUser(owner))) return [404, { ok: false, error: 'Utilisateur introuvable.' }];
      const key = await pool.addKey({ provider: String(payload.provider ?? ''), secret: payload.key, label: payload.label, owner, createdBy: ADMIN, public: payload.public === true }, env);
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
    case 'setKeyPublic':
      await pool.setKeyPublic(Number(payload.id), payload.public !== false);
      await log(payload.public === false ? 'Clé IA retirée du public' : 'Clé IA rendue publique', `#${Number(payload.id)}`);
      return [200, { ok: true }];
    case 'setKeyDisabled':
      await pool.setKeyDisabled(Number(payload.id), payload.disabled !== false, 'désactivée par l’admin');
      await log(payload.disabled === false ? 'Clé IA réactivée' : 'Clé IA désactivée', `#${Number(payload.id)}`);
      return [200, { ok: true }];
    case 'deleteKey':
      await pool.deleteKey(Number(payload.id));
      await log('Clé IA supprimée', `#${Number(payload.id)}`);
      return [200, { ok: true }];
    // --- Boutique de crédits et paiement LightPay ----------------------------------------------
    case 'shop': {
      const cfg = await lightpayConfig(env);
      return [200, { ok: true, aiPacks: await listAiPacks(), packs: await listPacks(), orders: await recentOrders(100), stats: await salesStats(), lightpay: { env: cfg.env, ready: cfg.ready, key: Boolean(cfg.key), payee: cfg.payee }, settings: (await listSettings(env)).filter((x) => x.key.startsWith('lightpay.')) }];
    }
    case 'savePacks': {
      const r = checkPacks(payload.packs);
      if (!r.ok) return [400, { ok: false, error: r.error }];
      await savePacks(r.packs);
      await log('Prix des crédits modifiés', r.packs.map((p) => `${p.credits} cr. ${p.promoPrice ? `${p.promoPrice} (au lieu de ${p.price})` : p.price} FCFA${p.active ? '' : ' (retiré)'}`).join(' · '));
      return [200, { ok: true, packs: r.packs }];
    }
    case 'lightpayConnectStart': {
      const r = await connectStart(String(payload.redirectUri ?? ''), env);
      return [r.ok ? 200 : 400, r];
    }
    case 'lightpayConnect': {
      const r = await connectFinish(String(payload.code ?? ''), String(payload.state ?? ''), env);
      if (!r.ok) return [400, r];
      await setSetting(r.env === 'production' ? 'lightpay.payeeProduction' : 'lightpay.payeeSandbox', r.connection, env);
      await log('Wallet LightPay connecté', `${r.env} · ${r.connection}`);
      return [200, { ok: true, env: r.env, connection: r.connection }];
    }
    case 'settings':
      return [200, { ok: true, settings: await listSettings(env) }];
    case 'setSetting': {
      const key = String(payload.key ?? '');
      if (!DEFINITIONS[key]) return [400, { ok: false, error: 'Réglage inconnu.' }];
      if ((key.startsWith('quota.') || key.startsWith('grant.')) && !(Number.parseInt(payload.value, 10) >= 0)) return [400, { ok: false, error: 'Nombre de tokens attendu (0 ou plus).' }];
      if (key.startsWith('contact.')) {
        const c = checkContact(key, payload.value);
        if (!c.ok) return [400, { ok: false, error: c.error }];
        payload.value = c.value;
      }
      if (key === 'ai.userTokens' && !(Number.parseInt(payload.value, 10) >= 0)) return [400, { ok: false, error: 'Nombre de tokens attendu (0 ou plus).' }];
      if (key === 'ai.resetCost' && !(Number(String(payload.value).replace(',', '.')) >= 0)) return [400, { ok: false, error: 'Prix en crédits attendu (ex. 0,5).' }];
      if (key === 'studio.defaultTemplate' && !/^[a-z0-9-]{1,40}$/.test(String(payload.value))) return [400, { ok: false, error: 'Modèle inconnu.' }];
      if (key === 'lightpay.env' && !['sandbox', 'production'].includes(String(payload.value))) return [400, { ok: false, error: 'Environnement : sandbox ou production.' }];
      if (key === 'lightpay.testers' && String(payload.value).split(/[\s,;]+/).filter(Boolean).some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return [400, { ok: false, error: 'Comptes de test : des e-mails séparés par des virgules.' }];
      if ((key === 'lightpay.apiUrl' || key === 'lightpay.checkoutUrl') && !/^https:\/\/[^\s/]+$/.test(String(payload.value).replace(/\/$/, ''))) return [400, { ok: false, error: 'Adresse https attendue, sans chemin.' }];
      if (key === 'lightpay.keySandbox' && payload.value && !String(payload.value).startsWith('sec_test_')) return [400, { ok: false, error: 'La clé test commence par sec_test_.' }];
      if (key === 'lightpay.keyProduction' && payload.value && !String(payload.value).startsWith('sec_live_')) return [400, { ok: false, error: 'La clé live commence par sec_live_.' }];
      await setSetting(key, payload.value, env);
      await log('Réglage modifié', DEFINITIONS[key].secret ? `${key} (secret)` : `${key} = ${String(payload.value).slice(0, 80)}`);
      return [200, { ok: true, settings: await listSettings(env) }];
    }
    case 'cvs':
      return [200, { ok: true, cvs: await s.range('cvs', Math.min(Number(payload.limit) || 200, MAX_CVS)) }];
    case 'templates':
      return [200, { ok: true, templates: await s.get('templates', {}), specs: await s.get('templateSpecs', []), defaultTemplate: await getSetting('studio.defaultTemplate', env) }];
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
