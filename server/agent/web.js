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
import { importCv as importHandler } from '../cvimport/extract.js';
import { translate as translateCv } from './translate.js';
import { adminTokenFor, collect } from '../admin.js';
import { RateLimiter } from '../ratelimit.js';
import { getUser, recordLogin } from '../db/users.js';
import { keySourceFor, logUsage } from '../keys/pool.js';
import { addAnonUsage, anonUsage } from '../quota.js';
import { addUserUsage, publicUserQuota, userQuota } from '../aiquota.js';
import { verifyFirebaseIdToken } from '../accounts/firebase.js';
import { activateOnlineKey } from '../accounts/keys.js';
import { LIVE_WS, cleanStart, issueTicket, liveConfig, liveLoad, liveSetup, liveSkills, mintToken, noteSession, openSession, openTicket, orderKeys, runLiveTool } from './live.js';
import { redact } from './secrets.js';
import { keysFor as envKeys } from './llm/providers.js';

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
  if (!token) return [503, { ok: false, error: 'Connexion indisponible : le serveur n’est pas encore configuré (clé maître manquante). Préviens l’administrateur.' }];
  if ((await recordLogin(username).catch(() => ({}))).blocked) return [403, { ok: false, error: 'Ce compte est suspendu. Contacte salacv.' }];
  return [200, { ok: true, token, username }];
}

// Connexion Google : le navigateur donne un jeton Firebase, on le vérifie ici et on ouvre une session salacv.
export async function googleLogin(payload, client, env = process.env, { verifyToken = verifyFirebaseIdToken } = {}) {
  if (!loginLimiter.allow(client)) return [429, { ok: false, error: 'Trop de tentatives. Attends une minute.' }];
  const identity = await verifyToken(payload?.idToken, env);
  if (!identity) return [401, { ok: false, error: 'Connexion Google refusée. Réessaie.' }];
  const token = issue(identity.email, env);
  if (!token) return [503, { ok: false, error: 'Connexion indisponible : le serveur n’est pas encore configuré (clé maître manquante). Préviens l’administrateur.' }];
  if ((await recordLogin(identity.email, { name: identity.name, picture: identity.picture }).catch(() => ({}))).blocked) return [403, { ok: false, error: 'Ce compte est suspendu. Contacte salacv.' }];
  const adminToken = await adminTokenFor(identity, env).catch(() => null); // retiré de la réponse par server/http.js
  return [200, { ok: true, token, username: identity.email, name: identity.name, picture: identity.picture, kind: 'google', ...(adminToken ? { adminToken } : {}) }];
}

// Clé KEYGEN en ligne (PC uniquement) : la session ne dépasse jamais la fin de vie de la clé.
export async function keyLogin(payload, client, env = process.env, now = Date.now(), { days } = {}) {
  if (!loginLimiter.allow(client)) return [429, { ok: false, error: 'Trop de tentatives. Attends une minute.' }];
  const [status, body] = await activateOnlineKey(payload?.key, payload?.device, { now, ...(days ? { days } : {}) });
  if (!body.ok) return [status, body];
  const username = `key:${body.id}`;
  const token = issue(username, env, now, (body.expiresAt - now) / 1000);
  if (!token) return [503, { ok: false, error: 'Connexion indisponible : le serveur n’est pas encore configuré (clé maître manquante). Préviens l’administrateur.' }];
  if ((await recordLogin(username).catch(() => ({}))).blocked) return [403, { ok: false, error: 'Cette clé est suspendue. Contacte salacv.' }];
  return [200, { ok: true, token, username, kind: 'key', expiresAt: body.expiresAt }];
}

export const bearer = (authorization) => String(authorization ?? '').replace(/^Bearer\s+/i, '').trim();

// Accès à l'IA. Connecté : compte non suspendu, accès accordé (par défaut à la connexion, retirable par l'admin).
// Visiteur non connecté (web seulement) : IA « publique » limitée à 250 000 tokens, comptés par session ET par IP.
// L'app desktop, elle, exige toujours une connexion.
async function aiGuard(token, env, loginMessage, ctx) {
  const username = token ? verify(token, env) : null;
  if (token && !username) return { error: [401, { ok: false, error: loginMessage }] };
  if (!username) {
    if (!ctx || ctx.client === 'desktop') return { error: [401, { ok: false, error: loginMessage }] };
    const quota = await anonUsage(ctx, env);
    if (quota.exhausted) {
      return { error: [403, { ok: false, code: 'QUOTA', error: 'Tu as utilisé tes crédits IA gratuits. Connecte-toi pour continuer.', quota: publicQuota(quota) }] };
    }
    return { anonymous: true, who: `ip:${ctx.ip}` };
  }
  const user = await getUser(username).catch(() => null);
  if (user?.blocked) return { error: [403, { ok: false, error: 'Ce compte est suspendu.' }] };
  if (user && !user.aiAccess) return { error: [403, { ok: false, error: "Ton accès à l'assistant a été retiré. Contacte salacv." }] };
  const reserve = await userQuota(username, env);
  if (reserve.exhausted) {
    return { error: [403, { ok: false, code: 'AI_QUOTA', error: 'Ton IA est à court. Remets-la à zéro ou prends un pack IA pour continuer.', quota: publicUserQuota(reserve) }] };
  }
  return { username, who: username };
}

// Ce que le navigateur a le droit de savoir de son quota (jamais l'IP ni l'identifiant).
const publicQuota = (q) => ({ percent: q.percent, remaining: q.remaining, limit: q.limitSession, exhausted: q.exhausted });

// Clés pour CETTE requête ; en cas d'échec de la base : null (clés d'environnement pour un connecté, refus pour un visiteur).
async function keysFor(username, env, anonymous) {
  try {
    return await keySourceFor(username, env, { anonymous });
  } catch (err) {
    console.error(`[clés] ${err.message}`);
    return null;
  }
}

async function runAi(kind, payload, token, { env, callModel, ctx }, loginMessage, handler) {
  const guard = await aiGuard(token, env, loginMessage, ctx);
  if (guard.error) return guard.error;
  if (!agentLimiter.allow(guard.who)) return [429, { ok: false, error: 'Trop de demandes. Attends une minute.' }];
  // Plafond de requêtes simultanées : protège le quota et la mémoire, 503 au-delà.
  if (running >= settings.concurrency) return [503, { ok: false, error: kind === 'agent' ? "L'assistant est très demandé. Réessaie dans un instant." : 'Le service est très demandé. Réessaie dans un instant.' }];
  running++;
  try {
    const keySource = callModel ? null : await keysFor(guard.username, env, guard.anonymous);
    if (guard.anonymous && !callModel && !keySource) return [503, { ok: false, error: "L'assistant est indisponible pour le moment. Réessaie dans un instant." }];
    const { status, ...result } = await handler(payload ?? {}, { env, callModel, keySource, username: guard.username ?? null });
    const tokens = keySource?.tokens ?? 0;
    logUsage(guard.who, keySource?.lastUsedId ?? null, kind, Boolean(result.ok), tokens, keySource?.lastProvider ?? null);
    if (guard.anonymous) {
      await addAnonUsage(ctx, tokens).catch((err) => console.error(`[quota] ${err.message}`));
      result.quota = publicQuota(await anonUsage(ctx, env)); // la barre de progression se met à jour avec la réponse
    } else if (guard.username) {
      await addUserUsage(guard.username, tokens).catch((err) => console.error(`[quota] ${err.message}`));
      result.quota = publicUserQuota(await userQuota(guard.username, env)); // la barre de l'IA se vide avec la réponse
    }
    return [status ?? (result.ok ? 200 : 502), result];
  } finally {
    running--;
  }
}

export const agent = (payload, token, opts = {}) => runAi('agent', payload, token, { env: process.env, ...opts }, "Connecte-toi pour utiliser l'assistant.", handle);
// Import d'un CV (PDF ou photo) : un appel à l'IA, compté dans la réserve du compte (compte Google obligatoire).
export const importCv = (payload, token, opts = {}) => runAi('import', payload, token, { env: process.env, ...opts }, 'Connecte-toi avec Google pour importer ton CV.', importHandler);
export const translate = (payload, token, opts = {}) => runAi('translate', payload, token, { env: process.env, ...opts }, 'Connecte-toi pour traduire ton CV.', translateCv);

// Assistant en direct (Gemini Live, voir agent/live.js). Une seule route, trois actions :
//   start : mêmes droits que l'assistant écrit (compte ou visiteur avec quota) → jeton éphémère + ticket de session.
//           La clé est choisie par la rotation du direct (Admin → Live) et la session est notée (charge par clé).
//   tool  : un appel d'outil de Gemini (CV sous garde-fous, crédits, historique, génération) — ticket requis
//   usage : tokens consommés depuis le dernier compte rendu, ajoutés au quota ; end = la session est finie — ticket requis
export const liveLimiter = new RateLimiter(4); // sessions ouvertes par minute
export const liveToolLimiter = new RateLimiter(90); // appels d'outils par minute
const MAX_USAGE_REPORT = 200_000;

// Essais en local uniquement : SALACV_LIVE_ENV_KEY=1 laisse le direct utiliser GEMINI_API_KEY(S) de .env quand le pool
// n'a aucune clé Gemini pour cette personne. Jamais en ligne (les clés se gèrent dans l'admin).
function liveDevKeys(source, env) {
  if (env.SALACV_LIVE_ENV_KEY !== '1' || env.VERCEL) return source;
  if (source?.candidates((p) => p.name === 'gemini').length) return source;
  const keys = envKeys('gemini', env);
  if (!keys.length) return source;
  const skip = new Set();
  return {
    mode: 'env',
    lastUsedId: null,
    candidates: (accept) => (accept({ name: 'gemini' }) ? keys.filter((k) => !skip.has(k)).map((key) => ({ provider: { name: 'gemini' }, key, id: null })) : []),
    exhaust: async (e) => skip.add(e.key),
    invalid: async (e) => skip.add(e.key),
    used() {},
    secrets: () => keys,
  };
}

export async function live(payload, token, { env = process.env, ctx, fetchImpl } = {}) {
  const action = payload?.action;
  if (action === 'start') {
    const config = await liveConfig(env);
    if (!config.enabled) return [503, { ok: false, error: 'Le direct est en pause pour le moment. Utilise l’assistant écrit.' }];
    const guard = await aiGuard(token, env, "Connecte-toi pour parler à l'assistant en direct.", ctx);
    if (guard.error) return guard.error;
    if (!liveLimiter.allow(guard.who)) return [429, { ok: false, error: 'Trop de sessions. Attends une minute.' }];
    const keySource = liveDevKeys(await keysFor(guard.username, env, guard.anonymous), env);
    if (!keySource) return [503, { ok: false, error: 'Le direct est indisponible pour le moment. Réessaie dans un instant.' }];
    try {
      const loggedIn = Boolean(guard.username);
      const { history, versions } = cleanStart(payload);
      const setup = liveSetup(payload.state, { config, loggedIn, history, versions, skills: await liveSkills({ loggedIn }) });
      const { order, full } = orderKeys(keySource.candidates((p) => p.name === 'gemini'), guard.who, await liveLoad(), config);
      const { token: liveToken, expiresAt, keyId } = await mintToken(setup, keySource, { order, full, minutes: config.minutes, fetchImpl });
      const sid = await openSession({ who: guard.who, keyId, expiresAt });
      logUsage(guard.who, keyId, 'live', true, 0, 'gemini');
      return [
        200,
        { ok: true, token: liveToken, url: LIVE_WS, model: setup.model, expiresAt, ticket: issueTicket({ who: guard.who, username: guard.username, sid }, expiresAt, env) },
      ];
    } catch (err) {
      console.error(`[live] ${redact(err.message, keySource.secrets())}`);
      return [err.status ?? 503, { ok: false, error: err.userMessage ?? 'Le direct n’a pas pu démarrer. Réessaie.' }];
    }
  }

  const session = openTicket(payload?.ticket, env);
  if (!session) return [401, { ok: false, error: 'Session en direct expirée : relance le direct.' }];
  // Le ticket appartient à celui qui l'a ouvert (compte, ou visiteur de cette IP).
  const username = token ? verify(token, env) : null;
  if ((session.username ?? null) !== (username ?? null) || (!session.username && ctx && session.who !== `ip:${ctx.ip}`)) {
    return [403, { ok: false, error: 'Session en direct refusée.' }];
  }

  if (action === 'tool') {
    if (!liveToolLimiter.allow(session.who)) return [429, { ok: false, error: 'Trop de modifications d’un coup.' }];
    const { status, ...result } = await runLiveTool(payload, { username: session.username, env });
    return [status ?? 200, result];
  }

  if (action === 'usage') {
    const tokens = Math.max(0, Math.min(MAX_USAGE_REPORT, Math.round(Number(payload.tokens) || 0)));
    if (tokens) logUsage(session.who, null, 'live', true, tokens, 'gemini');
    await noteSession(session.sid, { tokens, end: payload.end === true });
    if (session.username) {
      await addUserUsage(session.username, tokens).catch((err) => console.error(`[quota] ${err.message}`));
      const quota = await userQuota(session.username, env);
      return [200, { ok: true, quota: publicUserQuota(quota), stop: quota.exhausted }];
    }
    if (!ctx) return [400, { ok: false, error: 'Requête invalide.' }];
    await addAnonUsage(ctx, tokens).catch((err) => console.error(`[quota] ${err.message}`));
    const quota = await anonUsage(ctx, env);
    return [200, { ok: true, quota: publicQuota(quota), stop: quota.exhausted }];
  }

  return [400, { ok: false, error: 'Action inconnue.' }];
}

// Qui suis-je ? (le navigateur ne voit jamais le jeton, il demande son identité au serveur)
export async function me(token, { env = process.env } = {}) {
  const username = token ? verify(token, env) : null;
  if (!username) return [200, { ok: true, loggedIn: false }];
  const user = await getUser(username).catch(() => null);
  if (user?.blocked) return [200, { ok: true, loggedIn: false }];
  return [
    200,
    {
      ok: true,
      loggedIn: true,
      username,
      name: user?.name ?? '',
      kind: username.startsWith('key:') ? 'key' : 'google',
      // « Mon compte » : photo Google, date d'inscription, dernière connexion, nombre de connexions.
      picture: user?.picture ?? '',
      since: user?.first ?? null,
      lastLogin: user?.last ?? null,
      logins: user?.logins ?? 0,
    },
  ];
}

// Où en est le visiteur ? (barre de progression) — rien de secret.
export async function usage(token, { env = process.env, ctx } = {}) {
  const username = token ? verify(token, env) : null;
  if (username) return [200, { ok: true, loggedIn: true, username, quota: publicUserQuota(await userQuota(username, env)) }];
  if (!ctx) return [400, { ok: false, error: 'Requête invalide.' }];
  return [200, { ok: true, loggedIn: false, desktop: ctx.client === 'desktop', quota: publicQuota(await anonUsage(ctx, env)) }];
}

// CV généré pendant la phase d'essai : conservé sans photo (annoncé avant la génération).
export const collectLimiter = new RateLimiter(20);
export async function collectCv(payload, token, client, env = process.env) {
  if (!collectLimiter.allow(client)) return [429, { ok: false }];
  await collect(payload?.resume, verify(token, env));
  return [200, { ok: true }];
}
