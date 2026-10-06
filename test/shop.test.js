// Boutique de crédits : prix réglés dans l'admin, paiement LightPay simulé (fetch remplacé), crédits ajoutés une seule fois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb, query } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import * as credits from '../server/credits.js';
import { setSetting } from '../server/settings.js';
import { issue } from '../server/agent/auth.js';
import { DEFAULT_PACKS, buyRoute, checkPacks, listPacks, orderRoute, savePacks, shopRoute, webhookRoute } from '../server/shop.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-pour-les-tests' };
const token = (u) => issue(u, ENV);
const req = { headers: { host: 'salacv.test', 'x-forwarded-proto': 'https' } };

// LightPay simulé : les sessions créées et leur état.
const sessions = new Map();
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  calls.push({ method: init.method, path: u.pathname, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (init.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
    const b = JSON.parse(init.body);
    const s = { id: `cs_test_${randomBytes(12).toString('hex')}`, status: 'OPEN', amount: b.amount, reference: b.reference };
    sessions.set(s.id, s);
    return json(201, { status: 'success', session: { ...s, checkout_url: `https://checkout.test/pay/${s.id}` } });
  }
  const m = u.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/);
  if (init.method === 'GET' && m && sessions.has(m[1])) return json(200, { status: 'success', session: sessions.get(m[1]) });
  return json(404, { error: 'NOT_FOUND' });
};
const sessionOf = (orderId) => [...sessions.values()].find((s) => s.reference === orderId);

test('packs : 1 crédit 300, 5 crédits 500, 10 crédits 1 500 par défaut', async () => {
  assert.deepEqual((await listPacks()).map((p) => [p.credits, p.price]), [[1, 300], [5, 500], [10, 1500]]);
  assert.deepEqual(DEFAULT_PACKS.map((p) => p.promoPrice), [null, null, null]);
});

test('packs : validation de l’admin (promo plus basse que le prix, minimum 100, pas de doublon)', () => {
  assert.equal(checkPacks([{ id: 'c1', credits: 1, price: 300, promoPrice: 250 }]).ok, true);
  assert.equal(checkPacks([{ id: 'c1', credits: 1, price: 300, promoPrice: 300 }]).ok, false);
  assert.equal(checkPacks([{ id: 'c1', credits: 1, price: 50 }]).ok, false);
  assert.equal(checkPacks([{ id: 'c1', credits: 0, price: 300 }]).ok, false);
  assert.equal(checkPacks([{ id: 'c1', credits: 1, price: 300 }, { id: 'c1', credits: 2, price: 500 }]).ok, false);
  assert.equal(checkPacks([{ id: 'c1', credits: 1, price: 300, promoPrice: '' }]).packs[0].promoPrice, null);
});

test('boutique fermée tant que la clé et le wallet LightPay ne sont pas réglés', async () => {
  const [, shop] = await shopRoute(null, { env: ENV });
  assert.equal(shop.open, false);
  const [status] = await buyRoute({ packId: 'c1' }, token('ana@example.com'), req, { env: ENV });
  assert.equal(status, 503);
});

test('achat : session LightPay au prix promo, crédits ajoutés une seule fois (webhook + client)', async () => {
  await setSetting('lightpay.keySandbox', 'sec_test_abc', ENV);
  await setSetting('lightpay.payeeSandbox', 'conn_salacv', ENV);
  await savePacks([{ id: 'c5', credits: 5, price: 500, promoPrice: 400, active: true }, { id: 'c10', credits: 10, price: 1500, promoPrice: null, active: false }]);

  const [, shop] = await shopRoute(null, { env: ENV });
  assert.equal(shop.open, true);
  assert.deepEqual(shop.packs.map((p) => [p.id, p.price, p.promoPrice]), [['c5', 500, 400]]); // pack retiré : invisible

  assert.equal((await buyRoute({ packId: 'c10' }, token('ana@example.com'), req, { env: ENV }))[0], 404);
  assert.equal((await buyRoute({ packId: 'c5' }, null, req, { env: ENV }))[0], 401);
  assert.equal((await buyRoute({ packId: 'c5' }, token('key:abc'), req, { env: ENV }))[0], 403);

  await credits.ensureAccount('ana@example.com', ENV); // un client connecté a déjà son compte (et son cadeau)
  const before = await credits.balance('ana@example.com');
  const [status, bought] = await buyRoute({ packId: 'c5' }, token('ana@example.com'), req, { env: ENV });
  assert.equal(status, 200);
  assert.equal(bought.amount, 400);
  const create = calls.find((c) => c.method === 'POST');
  assert.equal(create.headers.Authorization, 'Bearer sec_test_abc');
  assert.equal(create.headers['X-Environment'], 'sandbox');
  assert.equal(create.headers['Idempotency-Key'], bought.order);
  assert.equal(create.body.payee, 'conn_salacv');
  assert.equal(create.body.amount, '400');
  assert.equal(create.body.return_url, `https://salacv.test/dashboard/?order=${bought.order}#credits`);

  // Pas encore payé : rien n'est ajouté.
  let [, o] = await orderRoute({ orderId: bought.order }, token('ana@example.com'), { env: ENV });
  assert.equal(o.order.status, 'PENDING');
  assert.equal(o.balance, before);
  // Un autre compte ne voit pas la commande.
  assert.equal((await orderRoute({ orderId: bought.order }, token('bob@example.com'), { env: ENV }))[0], 404);

  sessionOf(bought.order).status = 'COMPLETED';
  await Promise.all([webhookRoute({ type: 'checkout.completed', data: { reference: bought.order } }, { env: ENV }), orderRoute({ orderId: bought.order }, token('ana@example.com'), { env: ENV })]);
  [, o] = await orderRoute({ orderId: bought.order }, token('ana@example.com'), { env: ENV });
  assert.equal(o.order.status, 'PAID');
  assert.equal(o.balance, before + 5);
  await webhookRoute({ type: 'checkout.completed', data: { reference: bought.order } }, { env: ENV });
  assert.equal(await credits.balance('ana@example.com'), before + 5); // rejoué : toujours une seule fois
});

test('achat : un montant qui ne correspond pas ou une session expirée ne crédite rien', async () => {
  await credits.ensureAccount('cleo@example.com', ENV);
  const start = await credits.balance('cleo@example.com');
  const [, a] = await buyRoute({ packId: 'c5' }, token('cleo@example.com'), req, { env: ENV });
  Object.assign(sessionOf(a.order), { status: 'COMPLETED', amount: '100' });
  await webhookRoute({ data: { reference: a.order } }, { env: ENV });
  assert.equal(await credits.balance('cleo@example.com'), start);

  const [, b] = await buyRoute({ packId: 'c5' }, token('cleo@example.com'), req, { env: ENV });
  sessionOf(b.order).status = 'EXPIRED';
  const [, o] = await orderRoute({ orderId: b.order }, token('cleo@example.com'), { env: ENV });
  assert.equal(o.order.status, 'EXPIRED');
  assert.equal(o.balance, start);
  const [row] = await query('SELECT status FROM credit_orders WHERE id = $1', [b.order]);
  assert.equal(row.status, 'EXPIRED');
});
