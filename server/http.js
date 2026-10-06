// Adaptateur HTTP commun : le même code sert les fonctions Vercel (api/*.js) et le serveur
// Node du VPS (server/index.js). Vercel = VPS : aucune différence de comportement.
import * as web from './agent/web.js';
import { ADMIN_SECONDS, admin, templateSettings } from './admin.js';
import { ADMIN_COOKIE, SESSION_COOKIE, clearCookieString, clientIp, context, cookieString, readCookie } from './identity.js';
import { MAX_RENDER_BODY, creditsRoute, render } from './render.js';
import { feedback, statsRoute } from './feedback.js';
import { MAX_PROJECTS_BODY, projectsRoute } from './projects.js';
import { signingSecret } from './agent/auth.js';
import { db } from './db/index.js';
import { configRoute } from './keys/routes.js';
import { buyRoute, orderRoute, shopRoute, webhookRoute } from './shop.js';

function send(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(data);
}

// Corps JSON : déjà lu par Vercel (req.body), à lire soi-même sur un serveur Node nu.
async function readJson(req, max) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('trop grand'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

// Contexte de la requête (IP normalisée, session anonyme signée, type de client) : voir server/identity.js.
// Jeton de la requête : en-tête Authorization (app desktop : le relais le porte) ou cookie httpOnly (web).
const tokenOf = (req, cookie = SESSION_COOKIE) => web.bearer(req.headers.authorization) || readCookie(req, cookie);
const SESSION_SECONDS = 7 * 24 * 3600;

// Connexion réussie : le jeton va dans un cookie httpOnly. Le navigateur ne le reçoit JAMAIS dans la réponse ; seul le relais de
// l'app desktop (qui se déclare) le reçoit, pour le garder dans le coffre du système.
export async function withSession(promise, req, ctx) {
  const [status, body] = await promise;
  if (!body?.ok || !body.token) return [status, body];
  const token = body.token;
  const maxAge = body.expiresAt ? (body.expiresAt - Date.now()) / 1000 : SESSION_SECONDS;
  const out = { ...body };
  if (ctx.client !== 'desktop') delete out.token;
  return [status, out, { 'Set-Cookie': cookieString(SESSION_COOKIE, token, Math.min(maxAge, SESSION_SECONDS), req) }];
}

const withCookie = async (promise, ctx) => {
  const [status, body] = await promise;
  return ctx.setCookie ? [status, body, { 'Set-Cookie': ctx.setCookie }] : [status, body];
};

export const ROUTES = {
  // Connexion par mot de passe (fictive) : fermée. Google et les clés KEYGEN la remplacent ;
  // SALACV_ALLOW_PASSWORD_LOGIN=1 ne sert qu'aux essais en local.
  login: (payload, req) =>
    process.env.SALACV_ALLOW_PASSWORD_LOGIN === '1'
      ? withSession(web.login(payload, clientIp(req)), req, context(req))
      : [410, { ok: false, error: 'La connexion par mot de passe n’existe plus : utilise Google ou une clé.' }],
  google: async (payload, req) => {
    // Compte administrateur : la même connexion ouvre aussi la session admin (cookie à part, 8 h). Jamais pour l'app desktop.
    const [status, body] = await web.googleLogin(payload, clientIp(req));
    const { adminToken, ...rest } = body ?? {};
    const ctx = context(req);
    const [s, out, headers = {}] = await withSession(Promise.resolve([status, rest]), req, ctx);
    if (!adminToken || ctx.client === 'desktop' || !out?.ok) return [s, out, headers];
    return [s, out, { 'Set-Cookie': [headers['Set-Cookie'], cookieString(ADMIN_COOKIE, adminToken, ADMIN_SECONDS, req)].filter(Boolean) }];
  },
  key: (payload, req) => withSession(web.keyLogin(payload, clientIp(req)), req, context(req)),
  me: (payload, req) => web.me(tokenOf(req)),
  logout: (payload, req) => [200, { ok: true }, { 'Set-Cookie': [clearCookieString(SESSION_COOKIE, req), clearCookieString(ADMIN_COOKIE, req)] }],
  agent: (payload, req) => {
    const ctx = context(req);
    return withCookie(web.agent(payload, tokenOf(req), { ctx }), ctx);
  },
  translate: (payload, req) => {
    const ctx = context(req);
    return withCookie(web.translate(payload, tokenOf(req), { ctx }), ctx);
  },
  render: (payload, req) => {
    const ctx = context(req);
    return withCookie(render(payload, tokenOf(req), { ctx }), ctx);
  },
  credits: (payload, req) => creditsRoute(tokenOf(req)),
  // Achat de crédits (LightPay) : packs en vente, achat, suivi d'une commande, webhook de LightPay.
  shop: (payload, req) => shopRoute(tokenOf(req)),
  buy: (payload, req) => buyRoute(payload, tokenOf(req), req),
  order: (payload, req) => orderRoute(payload, tokenOf(req)),
  lightpay: (payload) => webhookRoute(payload),
  feedback: (payload, req) => {
    const ctx = context(req);
    return withCookie(feedback(payload, tokenOf(req), { ctx }), ctx);
  },
  stats: () => statsRoute(),
  // Diagnostic de démarrage : seulement des oui/non (jamais une valeur). Ouvrable dans le navigateur (GET).
  status: async () => {
    const env = process.env;
    const masterOk = (() => {
      try {
        return Buffer.from(env.SALACV_MASTER_KEY ?? '', 'base64').length === 32;
      } catch {
        return false;
      }
    })();
    let dbOk = false;
    try {
      dbOk = Boolean(await db());
    } catch {}
    const checks = { database: dbOk, masterKey: masterOk, sessionSigning: Boolean(signingSecret(env)), adminUid: Boolean(String(env.SALACV_ADMIN_UID ?? '').trim()) };
    const names = { database: 'DATABASE_URL', masterKey: 'SALACV_MASTER_KEY', sessionSigning: 'SALACV_MASTER_KEY', adminUid: 'SALACV_ADMIN_UID' };
    const missing = [...new Set(Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => names[k]))];
    return [200, { ok: true, ready: missing.length === 0, checks, missing }];
  },
  projects: (payload, req) => projectsRoute(payload, tokenOf(req), { ip: clientIp(req) }),
  usage: (payload, req) => {
    const ctx = context(req);
    return withCookie(web.usage(tokenOf(req), { ctx }), ctx);
  },
  collect: (payload, req) => web.collectCv(payload, tokenOf(req), clientIp(req)),
  config: () => configRoute(),
  admin: async (payload, req) => {
    const [status, body] = await admin(payload, tokenOf(req, ADMIN_COOKIE));
    // Connexion admin : cookie httpOnly de 8 h, jamais le jeton dans la réponse.
    if (payload.action === 'login' && body.ok && body.token) {
      const { token, ...rest } = body;
      return [status, rest, { 'Set-Cookie': cookieString(ADMIN_COOKIE, token, 8 * 3600, req) }];
    }
    return [status, body];
  },
  // Public : réglages des modèles (disponibles, pour qui), lus par le studio.
  templates: () => templateSettings(),
};

// Taille maximale du corps par route (les ressources de l'admin sont plus lourdes).
const MAX_BODY = { admin: 2 * 1024 * 1024, render: MAX_RENDER_BODY, projects: MAX_PROJECTS_BODY };
const limit = (name) => MAX_BODY[name] ?? web.MAX_BODY;

export async function serve(name, req, res) {
  if (name === 'status' && req.method === 'GET') {
    const [status, body] = await ROUTES.status();
    return send(res, status, body);
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Méthode non autorisée.' });
  let payload;
  try {
    payload = await readJson(req, limit(name));
  } catch (err) {
    return send(res, err.status ?? 400, { ok: false, error: err.status === 413 ? 'Requête trop grande.' : 'JSON invalide.' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > limit(name)) {
    return send(res, 400, { ok: false, error: 'Requête invalide.' });
  }
  try {
    const [status, body, headers] = await ROUTES[name](payload, req);
    send(res, status, body, headers);
  } catch (err) {
    console.error(`[api/${name}] ${err.name}`);
    send(res, 500, { ok: false, error: 'Erreur interne.' });
  }
}
