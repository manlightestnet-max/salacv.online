// Exemple minimal LightPay, Node 18+ sans dépendance : node server.mjs
//
//   LIGHTPAY_KEY=sec_test_…           clé secrète (test ou live : elle décide de l'environnement)
//   LIGHTPAY_ENV=sandbox              sandbox | production (cohérent avec la clé)
//   LIGHTPAY_PAYEE=conn_…             wallet qui encaisse (obtenu par /connect/start)
//   LIGHTPAY_APP_ID=ma-boutique       identifiant de l'app (pour Connect)
//   LIGHTPAY_WEBHOOK_SECRET=whsec_…   facultatif : vérifie la signature des webhooks
//   SITE=https://mon-site.com         adresse publique du site (retours LightPay)
//
// Commandes en mémoire pour rester court : en vrai, une table avec une contrainte d'unicité
// sur la livraison (voir deliver()).
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API = 'https://api.smlab.xyz/v1';
const CHECKOUT = 'https://checkout.smlab.xyz';
const { LIGHTPAY_KEY, LIGHTPAY_PAYEE, LIGHTPAY_APP_ID, LIGHTPAY_WEBHOOK_SECRET } = process.env;
const ENV = process.env.LIGHTPAY_ENV === 'production' ? 'production' : 'sandbox';
const SITE = (process.env.SITE ?? 'http://localhost:3000').replace(/\/$/, '');

const PRODUCTS = { ebook: { name: 'E-book', price: 1500 } };
const orders = new Map(); // id → { id, product, amount, env, status, sessionId }
const delivered = new Set(); // en vrai : UNIQUE(order_id) en base
let connectPending = null; // { state, verifier }

async function lightpay(method, path, body, idempotencyKey) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${LIGHTPAY_KEY}`,
      'X-Environment': ENV,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? data.error ?? `LightPay ${res.status}`), { status: res.status });
  return data;
}

// Livraison : une seule fois par commande, même si webhook et client arrivent ensemble.
function deliver(order) {
  if (delivered.has(order.id)) return;
  delivered.add(order.id);
  order.status = 'PAID';
  console.log(`Livré : ${order.product} (commande ${order.id})`);
}

// La seule source de vérité : la session relue chez LightPay avec la clé secrète.
async function reconcile(order) {
  if (order.status !== 'PENDING' || !order.sessionId) return order;
  const { session } = await lightpay('GET', `/checkout/sessions/${encodeURIComponent(order.sessionId)}`);
  if (session.status === 'COMPLETED' && session.reference === order.id && Number(session.amount) === order.amount) deliver(order);
  else if (session.status === 'EXPIRED' || session.status === 'CANCELLED') order.status = session.status;
  return order;
}

// Signature : t=<secondes>,v1=<hex HMAC-SHA256(secret, "t.<corps brut>")>, moins de 5 min.
function signatureOk(raw, header = '') {
  if (!LIGHTPAY_WEBHOOK_SECRET) return true; // de toute façon, rien n'est livré sans relecture
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac('sha256', LIGHTPAY_WEBHOOK_SECRET).update(`${parts.t}.${raw}`).digest('hex');
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

const ROUTES = {
  // Le client choisit un produit : commande + session LightPay → adresse de paiement.
  'POST /api/buy': async ({ body }) => {
    const product = PRODUCTS[body.product];
    if (!product) return [404, { error: 'Produit inconnu' }];
    const order = { id: `ord_${crypto.randomBytes(12).toString('base64url')}`, product: body.product, amount: product.price, env: ENV, status: 'PENDING', sessionId: null };
    orders.set(order.id, order);
    const { session } = await lightpay(
      'POST',
      '/checkout/sessions',
      {
        amount: String(order.amount),
        fee_amount: '0',
        currency: 'XAF',
        payee: LIGHTPAY_PAYEE,
        escrow: false, // produit numérique livré tout de suite
        reference: order.id,
        description: product.name,
        return_url: `${SITE}/?order=${order.id}`,
        cancel_url: `${SITE}/`,
        expires_in_minutes: 30,
        metadata: { product: body.product },
      },
      order.id, // Idempotency-Key : un double clic = la même session
    );
    order.sessionId = session.id;
    return [200, { order: order.id, checkoutUrl: session.checkout_url }];
  },

  // Le client demande où en est sa commande (après le dialogue ou au retour sur return_url).
  'POST /api/order': async ({ body }) => {
    const order = orders.get(String(body.orderId));
    if (!order) return [404, { error: 'Commande inconnue' }];
    await reconcile(order);
    return [200, { status: order.status }];
  },

  // Webhook : il dit seulement quelle commande relire.
  'POST /api/lightpay': async ({ body, raw, req }) => {
    if (!signatureOk(raw, req.headers['lightpay-signature'])) return [400, { error: 'signature' }];
    const order = orders.get(String(body?.data?.reference ?? ''));
    if (order) await reconcile(order); // LightPay injoignable → throw → 500 → LightPay retente
    return [200, { ok: true }];
  },

  // Connecter le wallet qui encaisse (une fois par environnement). Déclare `${SITE}/connect/callback` dans la console.
  'GET /connect/start': async () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    connectPending = { state: crypto.randomBytes(16).toString('base64url'), verifier };
    const u = new URL(`${CHECKOUT}/connect`);
    u.search = new URLSearchParams({
      app_id: LIGHTPAY_APP_ID,
      scope: 'payee',
      redirect_uri: `${SITE}/connect/callback`,
      state: connectPending.state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      environment: ENV,
    });
    return [302, null, { Location: u.toString() }];
  },
  'GET /connect/callback': async ({ url }) => {
    const pending = connectPending;
    connectPending = null;
    if (!pending || url.searchParams.get('state') !== pending.state || !url.searchParams.get('code')) return [400, { error: 'Connexion annulée ou expirée' }];
    const { connection } = await lightpay('POST', '/connect/token', { code: url.searchParams.get('code'), redirect_uri: `${SITE}/connect/callback`, code_verifier: pending.verifier });
    console.log(`Wallet connecté (${ENV}) : LIGHTPAY_PAYEE=${connection.id}`);
    return [200, { connection: connection.id, environment: ENV }];
  },
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, SITE);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/client.js')) {
        const file = url.pathname === '/' ? 'index.html' : 'client.js';
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
        return res.end(await readFile(new URL(file, import.meta.url)));
      }
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return res.writeHead(404).end();
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const [status, body, headers = {}] = await route({ req, url, raw, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body ? JSON.stringify(body) : undefined);
    } catch (err) {
      console.error(err);
      res.writeHead(err.status && err.status < 500 ? 400 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Paiement indisponible, réessaie.' }));
    }
  })
  .listen(3000, () => console.log(`http://localhost:3000 (${ENV})`));
