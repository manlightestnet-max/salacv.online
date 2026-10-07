// IA des comptes connectés : réserve réglée dans l'admin, sans recharge ; remise à zéro (0,5 crédit) et packs IA en crédits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import * as credits from '../server/credits.js';
import { setSetting } from '../server/settings.js';
import { issue } from '../server/agent/auth.js';
import { recordLogin } from '../server/db/users.js';
import { addUserUsage, adminSetAi, checkAiPacks, saveAiPacks, userQuota } from '../server/aiquota.js';
import { aiBuyRoute, aiQuotaRoute, aiResetRoute } from '../server/airoutes.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-pour-les-tests' };
Object.assign(process.env, ENV);
const token = (u) => issue(u, ENV);

test('réserve : réglage de l’admin, se vide, ne se recharge pas seule', async () => {
  await recordLogin('ana');
  await setSetting('ai.userTokens', '10000', ENV);
  assert.deepEqual(await userQuota('ana', ENV), { limit: 10000, used: 0, remaining: 10000, percent: 0, exhausted: false, custom: false });
  await addUserUsage('ana', 7500);
  assert.equal((await userQuota('ana', ENV)).percent, 75);
  await addUserUsage('ana', 5000);
  const q = await userQuota('ana', ENV);
  assert.equal(q.remaining, 0);
  assert.equal(q.exhausted, true);
});

test('remise à zéro : 0,5 crédit, refusée sans crédit, crédits au dixième', async () => {
  const [status, r] = await aiResetRoute(token('ana'), { env: ENV });
  assert.equal(status, 402);
  assert.equal(r.code, 'NO_CREDIT');
  await credits.ensureAccount('ana', ENV);
  await credits.add('ana', 1, 'test', 'test:ana:1');
  const before = await credits.balance('ana');
  const [ok, done] = await aiResetRoute(token('ana'), { env: ENV });
  assert.equal(ok, 200);
  assert.equal(done.balance, before - 0.5);
  assert.equal(done.quota.percent, 0);
  assert.equal(await credits.balance('ana'), before - 0.5);
});

test('packs IA : aucun au départ, créés par l’admin, achetés en crédits', async () => {
  let [, info] = await aiQuotaRoute(token('ana'), { env: ENV });
  assert.deepEqual(info.packs, []);
  assert.equal(info.resetCost, 0.5);
  assert.equal(checkAiPacks([{ id: 'x', name: 'X', tokens: 10, credits: 1 }]).ok, false);
  assert.equal(checkAiPacks([{ id: 'x', name: 'X', tokens: 5000, credits: 0.25 }]).ok, false);
  const r = checkAiPacks([{ id: 'mega', name: 'MegaIA Push', tokens: 50000, credits: '5', days: 30 }]);
  assert.equal(r.ok, true);
  await saveAiPacks(r.packs);
  [, info] = await aiQuotaRoute(token('ana'), { env: ENV });
  assert.equal(info.packs[0].name, 'MegaIA Push');
  const [refused] = await aiBuyRoute({ packId: 'mega' }, token('ana'), { env: ENV });
  assert.equal(refused, 402); // pas assez de crédits : rien n'est ajouté
  assert.equal((await userQuota('ana', ENV)).limit, 10000);
  await credits.add('ana', 5, 'test', 'test:ana:5');
  const [ok, bought] = await aiBuyRoute({ packId: 'mega' }, token('ana'), { env: ENV });
  assert.equal(ok, 200);
  assert.equal(bought.quota.limit, 60000);
});

test('admin : plafond propre au compte, tokens offerts, remise à zéro', async () => {
  await recordLogin('ben');
  await addUserUsage('ben', 9000);
  assert.equal((await adminSetAi('ben', { customLimit: 'abc' })).ok, false);
  await adminSetAi('ben', { customLimit: 20000, addTokens: 1000 });
  let q = await userQuota('ben', ENV);
  assert.equal(q.limit, 21000);
  assert.equal(q.custom, true);
  await adminSetAi('ben', { reset: true, customLimit: null });
  q = await userQuota('ben', ENV);
  assert.equal(q.used, 0);
  assert.equal(q.limit, 11000);
});
