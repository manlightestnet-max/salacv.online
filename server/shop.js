// Boutique de crédits : les packs (crédits, prix, prix promo) se règlent dans l'admin ; le paiement passe par
// LightPay (MTN MoMo, Airtel Money ou wallet LightPay, au choix du client sur la page LightPay).
//
//   achat   POST /api/buy {packId}        → commande PENDING + session LightPay → checkoutUrl (dialogue lightpay.js)
//   suivi   POST /api/order {orderId}     → demande l'état à LightPay ; payé → crédits ajoutés (une seule fois)
//   webhook POST /api/lightpay            → « checkout.completed » : l'état est relu chez LightPay avant tout crédit
//
// L'argent va directement sur le wallet LightPay de salacv (payee = sa connexion LightPay, sans séquestre).
// La clé secrète LightPay ne quitte jamais le serveur ; le navigateur ne reçoit que l'adresse de la page de paiement.
import crypto from 'node:crypto';
import { query } from './db/index.js';
import { verify } from './agent/auth.js';
import { getUser } from './db/users.js';
import { store } from './store.js';
import { getSetting } from './settings.js';
import * as credits from './credits.js';

// --- Packs (réglés dans l'admin) ---------------------------------------------------------------
// promoPrice : prix réduit affiché à côté du prix barré ; null = pas de réduction.
export const DEFAULT_PACKS = [
  { id: 'c1', credits: 1, price: 300, promoPrice: null, active: true },
  { id: 'c5', credits: 5, price: 500, promoPrice: null, active: true },
  { id: 'c10', credits: 10, price: 1500, promoPrice: null, active: true },
];
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;
const MAX_PACKS = 12;

export const effectivePrice = (p) => (p.promoPrice && p.promoPrice < p.price ? p.promoPrice : p.price);

export async function listPacks() {
  return (await store().get('creditPacks', null)) ?? structuredClone(DEFAULT_PACKS);
}

// Validation complète d'une liste envoyée par l'admin : rien d'à moitié valide n'est enregistré.
export function checkPacks(input) {
  if (!Array.isArray(input) || input.length > MAX_PACKS) return { ok: false, error: `Entre 0 et ${MAX_PACKS} packs.` };
  const seen = new Set();
  const packs = [];
  for (const raw of input) {
    const p = {
      id: String(raw?.id ?? '').trim(),
      credits: Number(raw?.credits),
      price: Number(raw?.price),
      promoPrice: raw?.promoPrice === null || raw?.promoPrice === '' || raw?.promoPrice === undefined ? null : Number(raw.promoPrice),
      active: raw?.active !== false,
    };
    if (!PACK_ID.test(p.id) || seen.has(p.id)) return { ok: false, error: `Identifiant de pack invalide ou en double : « ${p.id} ».` };
    if (!Number.isInteger(p.credits) || p.credits < 1 || p.credits > 1000) return { ok: false, error: `Pack ${p.id} : nombre de crédits entre 1 et 1000.` };
    if (!Number.isInteger(p.price) || p.price < 100 || p.price > 1000000) return { ok: false, error: `Pack ${p.id} : prix entier entre 100 et 1 000 000 FCFA.` };
    if (p.promoPrice !== null && (!Number.isInteger(p.promoPrice) || p.promoPrice < 100 || p.promoPrice >= p.price)) {
      return { ok: false, error: `Pack ${p.id} : le prix promo doit être un entier d’au moins 100 FCFA, plus bas que le prix normal.` };
    }
    seen.add(p.id);
    packs.push(p);
  }
  return { ok: true, packs };
}

export const savePacks = (packs) => store().set('creditPacks', packs);

// --- LightPay : réglages de l'admin -----------------------------------------------------------
// forced : l'environnement d'une commande déjà créée (elle est toujours relue là où elle a été payée).
export async function lightpayConfig(env = process.env, forced = null) {
  const mode = (forced ?? (await getSetting('lightpay.env', env))) === 'production' ? 'production' : 'sandbox';
  const live = mode === 'production';
  const cfg = {
    env: mode,
    apiUrl: (await getSetting('lightpay.apiUrl', env)).replace(/\/$/, ''),
    checkoutUrl: (await getSetting('lightpay.checkoutUrl', env)).replace(/\/$/, ''),
    appId: await getSetting('lightpay.appId', env),
    key: await getSetting(live ? 'lightpay.keyProduction' : 'lightpay.keySandbox', env),
    payee: await getSetting(live ? 'lightpay.payeeProduction' : 'lightpay.payeeSandbox', env),
  };
  cfg.ready = Boolean(cfg.key && cfg.payee && cfg.apiUrl);
  return cfg;
}

export class LightPayError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Un appel à l'API LightPay (clé secrète côté serveur, environnement choisi par la clé et X-Environment).
export async function lightpayCall(cfg, method, path, body, idempotencyKey) {
  let res;
  try {
    res = await fetch(`${cfg.apiUrl}/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        'X-Environment': cfg.env,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new LightPayError('LightPay ne répond pas. Réessaie dans un instant.', 503, 'UNAVAILABLE');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[lightpay]', method, path, res.status, data?.error);
    throw new LightPayError('Paiement indisponible pour le moment. Réessaie.', res.status >= 500 ? 502 : 400, String(data?.error ?? 'LIGHTPAY_ERROR'));
  }
  return data;
}

// --- Commandes ----------------------------------------------------------------------------------
const ORDER_ID = /^ord_[A-Za-z0-9_-]{16,40}$/;

// L'adresse du site vue par le client (Vercel ou VPS), pour les retours depuis la page LightPay.
function siteOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

const userOf = async (token, env) => {
  const username = token ? verify(token, env) : null;
  if (!username) return null;
  const user = await getUser(username).catch(() => null);
  return user?.blocked ? null : username;
};

// Payé : les crédits d'abord (idempotent par la référence de la commande), puis la commande passe PAID.
// Rejouer (webhook + vérification du client en même temps) ne crédite jamais deux fois.
async function fulfill(order) {
  await credits.add(order.username, order.credits, `Achat · ${order.credits} crédit${order.credits > 1 ? 's' : ''}`, `order:${order.id}`);
  await query(`UPDATE credit_orders SET status = 'PAID', paid_at = now() WHERE id = $1 AND status <> 'PAID'`, [order.id]);
}

// Où en est la commande chez LightPay ? Met la commande à jour (payée, expirée, annulée) et la renvoie.
async function reconcile(order, env) {
  if (order.status !== 'PENDING' || !order.session_id) return order;
  const cfg = await lightpayConfig(env, order.env);
  if (!cfg.key) return order;
  const { session } = await lightpayCall(cfg, 'GET', `/checkout/sessions/${encodeURIComponent(order.session_id)}`);
  if (session.status === 'COMPLETED' && session.reference === order.id && Number(session.amount) === Number(order.amount)) {
    await fulfill(order);
    return { ...order, status: 'PAID' };
  }
  if (session.status === 'EXPIRED' || session.status === 'CANCELLED') {
    await query(`UPDATE credit_orders SET status = $2 WHERE id = $1 AND status = 'PENDING'`, [order.id, session.status]);
    return { ...order, status: session.status };
  }
  return order;
}

const orderView = (o) => ({ id: o.id, status: o.status, credits: Number(o.credits), amount: Number(o.amount), at: new Date(o.created_at).getTime() });

// --- Routes -------------------------------------------------------------------------------------
// Public : les packs en vente (prix, promo) et l'adresse des pages LightPay (pour lightpay.js).
export async function shopRoute(token, { env = process.env } = {}) {
  const cfg = await lightpayConfig(env);
  const packs = (await listPacks()).filter((p) => p.active).map((p) => ({ id: p.id, credits: p.credits, price: p.price, promoPrice: p.promoPrice && p.promoPrice < p.price ? p.promoPrice : null }));
  return [200, { ok: true, open: cfg.ready, checkoutUrl: cfg.checkoutUrl, test: cfg.env !== 'production', packs }];
}

export async function buyRoute(payload, token, req, { env = process.env } = {}) {
  const username = await userOf(token, env);
  if (!username) return [401, { ok: false, error: 'Connecte-toi pour acheter des crédits.' }];
  if (username.startsWith('key:')) return [403, { ok: false, error: 'L’achat de crédits se fait avec un compte Google.' }];
  const pack = (await listPacks()).find((p) => p.id === String(payload.packId ?? '') && p.active);
  if (!pack) return [404, { ok: false, error: 'Ce pack n’est plus en vente.' }];
  const cfg = await lightpayConfig(env);
  if (!cfg.ready) return [503, { ok: false, error: 'Le paiement n’est pas encore ouvert. Réessaie plus tard.' }];

  const id = `ord_${crypto.randomBytes(15).toString('base64url')}`;
  const amount = effectivePrice(pack);
  await query('INSERT INTO credit_orders (id, username, pack_id, credits, amount, env) VALUES ($1, $2, $3, $4, $5, $6)', [id, username, pack.id, pack.credits, amount, cfg.env]);
  const origin = siteOrigin(req);
  try {
    const { session } = await lightpayCall(
      cfg,
      'POST',
      '/checkout/sessions',
      {
        amount: String(amount),
        fee_amount: '0',
        currency: 'XAF',
        payee: cfg.payee,
        escrow: false,
        reference: id,
        description: `salacv · ${pack.credits} crédit${pack.credits > 1 ? 's' : ''}`,
        return_url: `${origin}/dashboard/?order=${id}#credits`,
        cancel_url: `${origin}/dashboard/#credits`,
        expires_in_minutes: 30,
        metadata: { order: id, pack: pack.id },
      },
      id,
    );
    await query('UPDATE credit_orders SET session_id = $2 WHERE id = $1', [id, session.id]);
    return [200, { ok: true, order: id, checkoutUrl: session.checkout_url, amount, credits: pack.credits }];
  } catch (err) {
    await query(`UPDATE credit_orders SET status = 'FAILED' WHERE id = $1`, [id]).catch(() => {});
    if (err instanceof LightPayError) return [err.status, { ok: false, error: err.message }];
    throw err;
  }
}

export async function orderRoute(payload, token, { env = process.env } = {}) {
  const username = await userOf(token, env);
  if (!username) return [401, { ok: false, error: 'Connexion requise.' }];
  const id = String(payload.orderId ?? '');
  if (!ORDER_ID.test(id)) return [400, { ok: false, error: 'Commande inconnue.' }];
  const [row] = await query('SELECT * FROM credit_orders WHERE id = $1 AND username = $2', [id, username]);
  if (!row) return [404, { ok: false, error: 'Commande inconnue.' }];
  let order = row;
  try {
    order = await reconcile(row, env);
  } catch (err) {
    if (!(err instanceof LightPayError)) throw err; // LightPay injoignable : on renvoie l'état connu, le client redemande
  }
  return [200, { ok: true, order: orderView(order), balance: await credits.balance(username) }];
}

// Webhook LightPay : le contenu ne sert qu'à savoir QUELLE commande relire ; l'état vient toujours de LightPay
// (avec notre clé secrète). Un message forgé ne peut donc jamais créditer quoi que ce soit.
export async function webhookRoute(payload, { env = process.env } = {}) {
  const ref = String(payload?.data?.reference ?? '');
  if (!ORDER_ID.test(ref)) return [200, { ok: true }];
  const [row] = await query('SELECT * FROM credit_orders WHERE id = $1', [ref]);
  if (!row) return [200, { ok: true }];
  try {
    await reconcile(row, env);
  } catch (err) {
    if (err instanceof LightPayError) return [503, { ok: false }]; // LightPay renverra le webhook
    throw err;
  }
  return [200, { ok: true }];
}

// --- Admin : commandes récentes -----------------------------------------------------------------
export async function recentOrders(n = 100) {
  const rows = await query('SELECT * FROM credit_orders ORDER BY created_at DESC LIMIT $1', [n]);
  return rows.map((o) => ({ ...orderView(o), username: o.username, pack: o.pack_id, env: o.env, paidAt: o.paid_at ? new Date(o.paid_at).getTime() : null }));
}

export async function salesStats() {
  const [r] = await query(`SELECT COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid, COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND env = 'production'), 0)::int AS revenue, COALESCE(SUM(credits) FILTER (WHERE status = 'PAID'), 0)::int AS credits FROM credit_orders`);
  return r ?? { paid: 0, revenue: 0, credits: 0 };
}

// --- Admin : connecter le wallet LightPay de salacv (LightPay Connect, PKCE S256) ---------------
export async function connectStart(redirectUri, env = process.env) {
  const cfg = await lightpayConfig(env);
  if (!cfg.key) return { ok: false, error: `Renseigne d’abord la clé secrète LightPay ${cfg.env === 'production' ? 'live' : 'test'}.` };
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');
  await store().set('lightpayConnect', { state, verifier, env: cfg.env, redirectUri, at: Date.now() });
  const u = new URL(`${cfg.checkoutUrl}/connect`);
  u.search = new URLSearchParams({ app_id: cfg.appId, scope: 'payee', redirect_uri: redirectUri, state, code_challenge: challenge, environment: cfg.env }).toString();
  return { ok: true, url: u.toString() };
}

export async function connectFinish(code, state, env = process.env) {
  const pending = await store().get('lightpayConnect', null);
  if (!pending || pending.state !== state || Date.now() - pending.at > 15 * 60000) return { ok: false, error: 'Demande expirée : relance la connexion du wallet.' };
  await store().set('lightpayConnect', null);
  const cfg = await lightpayConfig(env);
  if (cfg.env !== pending.env) return { ok: false, error: 'L’environnement LightPay a changé entre-temps : relance la connexion.' };
  try {
    const { connection } = await lightpayCall(cfg, 'POST', '/connect/token', { code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
    return { ok: true, env: cfg.env, connection: connection.id };
  } catch (err) {
    return { ok: false, error: err instanceof LightPayError ? 'LightPay a refusé la connexion. Relance-la.' : 'Connexion impossible.' };
  }
}
