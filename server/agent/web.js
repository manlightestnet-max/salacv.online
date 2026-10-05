// Les deux routes de l'API, identiques sur Vercel (api/*.js) et sur le VPS (server/index.js).
//
//   POST /api/login  { username, password }        → { ok, token, username }
//   POST /api/agent  { state, message, history? }  → { ok, reply, state, changes }   (Authorization: Bearer <jeton>)
//   POST /api/translate { state, to }               → { ok, state }                    (Authorization: Bearer <jeton>)
//
// Chaque route renvoie [statut HTTP, corps JSON].
import { checkCredentials, issue, verify } from './auth.js';
import { settings } from './config.js';
import { handle } from './run.js';
import { translate as translateCv } from './translate.js';
import { collect } from '../admin.js';
import { RateLimiter } from '../ratelimit.js';
import { getUser, recordLogin } from '../db/users.js';
import { keySourceFor, logUsage } from '../keys/pool.js';
import { verifyFirebaseIdToken } from '../accounts/firebase.js';
import { activateOnlineKey } from '../accounts/keys.js';

export const MAX_BODY = 64 * 1024;

export { RateLimiter };

export const loginLimiter = new RateLimiter(10);
export const agentLimiter = new RateLimiter(settings.ratePerMinute);
let running = 0;

export async function login(payload, client, env = process.env) {
  if (!loginLimiter.allow(client)) return [429, { ok: false, error: 'Trop de tentatives. Attends une minute.' }];
  const username = String(payload?.username ?? '').trim();
  const error = checkCredentials(username, payload?.password, env);
  if (error) return [400, { ok: false, error }];
  const token = issue(username, env);
  if (!token) return [503, { ok: false, error: "L'assistant n'est pas encore configuré." }];
  if ((await recordLogin(username).catch(() => ({}))).blocked) return [403, { ok: false, error: 'Ce compte est suspendu. Contacte salacv.' }];
  return [200, { ok: true, token, username }];
}

// Connexion Google : le navigateur donne un jeton Firebase, on le vérifie ici et on ouvre une session salacv.
export async function googleLogin(payload, client, env = process.env, { verifyToken = verifyFirebaseIdToken } = {}) {
  if (!loginLimiter.allow(client)) return [429, { ok: false, error: 'Trop de tentatives. Attends une minute.' }];
  const identity = await verifyToken(payload?.idToken, env);
  if (!identity) return [401, { ok: false, error: 'Connexion Google refusée. Réessaie.' }];
  const token = issue(identity.email, env);
  if (!token) return [503, { ok: false, error: "L'assistant n'est pas encore configuré." }];
  if ((await recordLogin(identity.email, { name: identity.name }).catch(() => ({}))).blocked) return [403, { ok: false, error: 'Ce compte est suspendu. Contacte salacv.' }];
  return [200, { ok: true, token, username: identity.email, name: identity.name, picture: identity.picture, kind: 'google' }];
}

// Clé KEYGEN en ligne (PC uniquement) : la session ne dépasse jamais la fin de vie de la clé.
export async function keyLogin(payload, client, env = process.env, now = Date.now(), { days } = {}) {
  if (!loginLimiter.allow(client)) return [429, { ok: false, error: 'Trop de tentatives. Attends une minute.' }];
  const [status, body] = await activateOnlineKey(payload?.key, payload?.device, { now, ...(days ? { days } : {}) });
  if (!body.ok) return [status, body];
  const username = `key:${body.id}`;
  const token = issue(username, env, now, (body.expiresAt - now) / 1000);
  if (!token) return [503, { ok: false, error: "L'assistant n'est pas encore configuré." }];
  if ((await recordLogin(username).catch(() => ({}))).blocked) return [403, { ok: false, error: 'Cette clé est suspendue. Contacte salacv.' }];
  return [200, { ok: true, token, username, kind: 'key', expiresAt: body.expiresAt }];
}

export const bearer = (authorization) => String(authorization ?? '').replace(/^Bearer\s+/i, '').trim();

// Accès à l'IA : connexion valide, compte non suspendu, accès accordé (par défaut à la connexion, retirable par l'admin).
async function aiGuard(token, env, loginMessage) {
  const username = verify(token, env);
  if (!username) return { error: [401, { ok: false, error: loginMessage }] };
  const user = await getUser(username).catch(() => null);
  if (user?.blocked) return { error: [403, { ok: false, error: 'Ce compte est suspendu.' }] };
  if (user && !user.aiAccess) return { error: [403, { ok: false, error: "Ton accès à l'assistant a été retiré. Contacte salacv." }] };
  return { username };
}

// Clés de CET utilisateur (les siennes si il en a, sinon le pool) ; si la base est indisponible, clés d'environnement.
async function keysFor(username, env) {
  try {
    return await keySourceFor(username, env);
  } catch (err) {
    console.error(`[clés] ${err.message}`);
    return null;
  }
}

export async function agent(payload, token, { env = process.env, callModel } = {}) {
  const guard = await aiGuard(token, env, "Connecte-toi pour utiliser l'assistant.");
  if (guard.error) return guard.error;
  const { username } = guard;
  if (!agentLimiter.allow(username)) return [429, { ok: false, error: 'Trop de demandes. Attends une minute.' }];
  // Plafond de requêtes simultanées : protège le quota et la mémoire, 503 au-delà.
  if (running >= settings.concurrency) return [503, { ok: false, error: "L'assistant est très demandé. Réessaie dans un instant." }];
  running++;
  try {
    const keySource = callModel ? null : await keysFor(username, env);
    const { status, ...result } = await handle(payload ?? {}, { env, callModel, keySource });
    logUsage(username, keySource?.lastUsedId ?? null, 'agent', Boolean(result.ok));
    return [status ?? (result.ok ? 200 : 502), result];
  } finally {
    running--;
  }
}

// Même garde-fous que l'agent : connexion, accès, limite par minute, plafond de requêtes simultanées.
export async function translate(payload, token, { env = process.env, callModel } = {}) {
  const guard = await aiGuard(token, env, 'Connecte-toi pour traduire ton CV.');
  if (guard.error) return guard.error;
  const { username } = guard;
  if (!agentLimiter.allow(username)) return [429, { ok: false, error: 'Trop de demandes. Attends une minute.' }];
  if (running >= settings.concurrency) return [503, { ok: false, error: 'Le service est très demandé. Réessaie dans un instant.' }];
  running++;
  try {
    const keySource = callModel ? null : await keysFor(username, env);
    const { status, ...result } = await translateCv(payload ?? {}, { env, callModel, keySource });
    logUsage(username, keySource?.lastUsedId ?? null, 'translate', Boolean(result.ok));
    return [status ?? (result.ok ? 200 : 502), result];
  } finally {
    running--;
  }
}

// CV généré pendant la phase d'essai : conservé sans photo (annoncé avant la génération).
export const collectLimiter = new RateLimiter(20);
export async function collectCv(payload, token, client, env = process.env) {
  if (!collectLimiter.allow(client)) return [429, { ok: false }];
  await collect(payload?.resume, verify(token, env));
  return [200, { ok: true }];
}
