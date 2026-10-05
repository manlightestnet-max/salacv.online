// Visiteur non connecté : identité (IP + cookie signé), quota de 250 000 tokens sans remise à zéro, clés « public ».
// Vraie base Postgres (PGlite en mémoire) ; aucun réseau, aucune vraie clé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb, query } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import { normalizeIp, clientIp, anonSession, context, ANON_COOKIE } from '../server/identity.js';
import { addAnonUsage, anonUsage } from '../server/quota.js';
import { addKey, keySourceFor, setKeyPublic, assignKey } from '../server/keys/pool.js';
import { tokensOf } from '../server/agent/llm/client.js';
import { admin } from '../server/admin.js';
import { setSetting } from '../server/settings.js';
import { recordLogin } from '../server/db/users.js';
import { issue } from '../server/agent/auth.js';
import * as web from '../server/agent/web.js';
import { ROUTES } from '../server/http.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-pour-les-tests', SALACV_ADMIN_UID: 'uid-admin-1' };
Object.assign(process.env, { SALACV_SESSION_SECRET: ENV.SALACV_SESSION_SECRET, SALACV_MASTER_KEY: ENV.SALACV_MASTER_KEY });
const SK = (n) => `sk-test-${String(n).padStart(2, '0')}-abcdefghijklmnop`;
const reqOf = (headers = {}, ip = '203.0.113.7') => ({ headers: { 'x-real-ip': ip, ...headers }, socket: { remoteAddress: '127.0.0.1' } });

test('IP : IPv4 telle quelle ; IPv6 réduite à son /64 ; IPv4 mappée ; valeur absurde', () => {
  assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:0db8:0001:0002::/64');
  // deux adresses du même /64 = la même personne : changer d'adresse ne remet rien à zéro
  assert.equal(normalizeIp('2001:db8:1:2::1'), normalizeIp('2001:db8:1:2:ffff:ffff:ffff:ffff'));
  assert.equal(normalizeIp('2001:db8::1'), '2001:0db8:0000:0000::/64');
  assert.equal(normalizeIp('pas une ip'), 'inconnue');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } }), '198.51.100.9');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '0000:0000:0000:0000::/64');
});

test('session anonyme : cookie signé, falsification refusée, nouveau cookie sinon', () => {
  const first = anonSession(reqOf(), ENV);
  assert.match(first.setCookie, new RegExp(`^${ANON_COOKIE}=[0-9a-f]{24}\\.`));
  assert.match(first.setCookie, /HttpOnly/);
  assert.match(first.setCookie, /SameSite=Lax/);
  const cookie = first.setCookie.split(';')[0];
  const again = anonSession(reqOf({ cookie }), ENV);
  assert.equal(again.sid, first.sid); // cookie valide : même session, rien à poser
  assert.equal(again.setCookie, null);
  const forged = anonSession(reqOf({ cookie: `${ANON_COOKIE}=${first.sid}.signaturefausse` }), ENV);
  assert.notEqual(forged.sid, first.sid); // falsifié : session neuve
  assert.ok(forged.setCookie);
  assert.equal(context(reqOf({ 'x-salacv-client': 'desktop' }), ENV).client, 'desktop');
  assert.equal(context(reqOf(), ENV).client, 'web');
});

test('jetons : usage du fournisseur, sinon estimation', () => {
  assert.equal(tokensOf({ usage: { total_tokens: 1234 } }, []), 1234);
  const estimate = tokensOf({ choices: [{ message: { content: 'x'.repeat(400) } }] }, [{ role: 'user', content: 'y'.repeat(400) }]);
  assert.ok(estimate >= 200 && estimate < 400);
});

test('quota : 250 000 par session ET par IP, jamais remis à zéro, effacer le cookie ne sert à rien', async () => {
  const ctx = { ip: '198.51.100.20', sid: 'session-a' };
  assert.deepEqual(await anonUsage(ctx, ENV), { session: 0, ip: 0, limitSession: 250000, limitIp: 250000, percent: 0, exhausted: false, remaining: 250000 });
  await addAnonUsage(ctx, 100000);
  await addAnonUsage(ctx, 50000);
  const u = await anonUsage(ctx, ENV);
  assert.equal(u.session, 150000);
  assert.equal(u.percent, 60);
  assert.equal(u.remaining, 100000);
  // le visiteur efface cookies et stockage : nouvelle session, MÊME IP → l'IP garde la mémoire
  const cleared = { ip: ctx.ip, sid: 'session-b' };
  const c = await anonUsage(cleared, ENV);
  assert.equal(c.session, 0);
  assert.equal(c.ip, 150000);
  assert.equal(c.percent, 60);
  await addAnonUsage(cleared, 100000);
  assert.equal((await anonUsage(cleared, ENV)).exhausted, true); // 250 000 atteints sur l'IP : bloqué malgré la session neuve
  // une autre IP, une autre session : intacte
  assert.equal((await anonUsage({ ip: '198.51.100.21', sid: 'session-c' }, ENV)).exhausted, false);
  // une même session qui change d'IP (4G) est bloquée par sa session
  await addAnonUsage({ ip: '198.51.100.30', sid: 'session-d' }, 250000);
  assert.equal((await anonUsage({ ip: '198.51.100.31', sid: 'session-d' }, ENV)).exhausted, true);
  await addAnonUsage(ctx, 0);
  await addAnonUsage(ctx, -5); // jamais de décrément
  assert.equal((await anonUsage(ctx, ENV)).session, 250000 - 100000);
});

test('clés « public » : seules utilisables par un visiteur ; jamais d’environnement ni de clé attribuée pour lui', async () => {
  await query('DELETE FROM api_keys');
  const priv = await addKey({ provider: 'ollama', secret: SK(1), createdBy: '#admin' }, ENV); // pool des connectés
  const pub = await addKey({ provider: 'ollama', secret: SK(2), createdBy: '#admin', public: true }, ENV);
  await assert.rejects(addKey({ provider: 'ollama', secret: SK(3), owner: 'x@y.z', public: true, createdBy: '#admin' }, ENV), /publique/);

  const anon = await keySourceFor(null, { ...ENV, OLLAMA_API_KEY: SK(9) }, { anonymous: true });
  assert.equal(anon.mode, 'public');
  assert.deepEqual(anon.secrets(), [SK(2)]); // ni la clé privée du pool, ni la clé d'environnement
  // connecté : le pool non public d'abord
  const logged = await keySourceFor('paul@example.com', ENV);
  assert.equal(logged.mode, 'pool');
  assert.deepEqual(logged.secrets(), [SK(1)]);
  // aucune clé publique : le visiteur n'a rien (et jamais l'environnement)
  await setKeyPublic(pub.id, false);
  assert.equal((await keySourceFor(null, { ...ENV, OLLAMA_API_KEY: SK(9) }, { anonymous: true })).next(), null);
  // pool des connectés vide mais une clé publique : le connecté se rabat dessus
  await query('DELETE FROM api_keys WHERE id = $1', [priv.id]);
  await setKeyPublic(pub.id, true);
  assert.equal((await keySourceFor('paul@example.com', ENV)).mode, 'public');
  // attribuer une clé la retire du public
  await assignKey(pub.id, 'luc@example.com');
  assert.equal((await query('SELECT public FROM api_keys WHERE id = $1', [pub.id]))[0].public, false);
  await assert.rejects(setKeyPublic(pub.id, true), /attribuée/);
});

test('IA du visiteur : quota compté depuis la réponse du fournisseur, refus net à l’épuisement, desktop exige la connexion', async () => {
  await query('DELETE FROM api_keys');
  await query('DELETE FROM anon_usage');
  const reply = (content, tokens) => new Response(JSON.stringify({ usage: { total_tokens: tokens }, choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'final_answer', arguments: JSON.stringify({ text: content }) } }] } }] }), { status: 200 });
  const realFetch = globalThis.fetch;
  let tokens = 90000;
  globalThis.fetch = async () => reply('Bonjour', tokens);
  const ctx = { ip: '192.0.2.50', sid: 'visiteur-1', client: 'web' };
  const run = (extra = {}) => web.agent({ message: 'salut', state: {} }, '', { env: ENV, ctx, ...extra });
  try {
    // sans clé « public » : indisponible, rien n'est compté
    assert.equal((await run())[0], 503);
    await addKey({ provider: 'ollama', secret: SK(20), createdBy: '#admin', public: true }, ENV);
    const [s1, b1] = await run();
    assert.equal(s1, 200);
    assert.equal(b1.quota.percent, 36); // 90 000 / 250 000
    assert.equal(b1.quota.remaining, 160000);
    assert.ok(!JSON.stringify(b1).includes('192.0.2.50'), 'l’IP ne sort jamais vers le navigateur');
    await run();
    const [s3, b3] = await run(); // 270 000 au total : dépassé après cette requête
    assert.equal(s3, 200); // la requête en cours va jusqu'au bout
    assert.equal(b3.quota.exhausted, true);
    const [s4, b4] = await run(); // la suivante est refusée avant tout appel au fournisseur
    assert.equal(s4, 403);
    assert.equal(b4.code, 'QUOTA');
    assert.match(b4.error, /Connecte-toi/);
    // l'app desktop : jamais d'IA sans connexion, même avec du quota
    const [sd] = await web.agent({ message: 'x', state: {} }, '', { env: ENV, ctx: { ip: '192.0.2.51', sid: 'd', client: 'desktop' } });
    assert.equal(sd, 401);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('/api/usage : barre de progression du visiteur (jamais l’IP) ; connecté reconnu', async () => {
  await query('DELETE FROM anon_usage');
  await addAnonUsage({ ip: '192.0.2.60', sid: 'v-60' }, 125000);
  const req = reqOf({ cookie: '' }, '192.0.2.60');
  const [status, body, headers] = await ROUTES.usage({}, req);
  assert.equal(status, 200);
  assert.equal(body.loggedIn, false);
  // sa session est neuve (pas de cookie) mais l'IP a déjà 125 000 : le pourcentage suit la contrainte la plus serrée
  assert.equal(body.quota.percent, 50);
  assert.ok(headers['Set-Cookie'], 'une session anonyme est posée au premier passage');
  assert.ok(!JSON.stringify(body).includes('192.0.2.60'));
  await recordLogin('zoe@example.com');
  const [, who] = await web.usage(issue('zoe@example.com', ENV), { env: ENV, ctx: { ip: 'x', sid: 'y', client: 'web' } });
  assert.deepEqual(who, { ok: true, loggedIn: true, username: 'zoe@example.com' });
});

test('admin : plafonds de quota réglables, clé rendue publique depuis l’interface', async () => {
  const adm = (await admin({ action: 'login', idToken: 'x' }, '', ENV, { verifyToken: async () => ({ uid: 'uid-admin-1', email: 'a@b.c', name: '' }) }))[1].token;
  await query('DELETE FROM api_keys');
  const [, added] = await admin({ action: 'addKey', provider: 'ollama', key: SK(30), public: true }, adm, ENV);
  assert.equal(added.key.public, true);
  assert.equal((await admin({ action: 'setKeyPublic', id: added.key.id, public: false }, adm, ENV))[0], 200);
  assert.equal((await admin({ action: 'setSetting', key: 'quota.ipTokens', value: '1000000' }, adm, ENV))[0], 200);
  assert.equal((await admin({ action: 'setSetting', key: 'quota.ipTokens', value: '-4' }, adm, ENV))[0], 400);
  const u = await anonUsage({ ip: '192.0.2.99', sid: 's-99' }, ENV);
  assert.equal(u.limitIp, 1000000);
  assert.equal(u.limitSession, 250000);
  await setSetting('quota.ipTokens', '250000', ENV);
});

test('sessions : la clé de signature est dérivée de SALACV_MASTER_KEY (aucune variable de plus), sans casser le reste', async () => {
  const { issue, verify, signingSecret } = await import('../server/agent/auth.js');
  const master = { SALACV_MASTER_KEY: randomBytes(32).toString('base64') };
  const token = issue('zoe@example.com', master);
  assert.ok(token, 'une session peut être signée avec la seule clé maître');
  assert.equal(verify(token, master), 'zoe@example.com');
  // une autre clé maître ne valide pas ce jeton
  assert.equal(verify(token, { SALACV_MASTER_KEY: randomBytes(32).toString('base64') }), null);
  // la clé de signature n'est pas la clé maître elle-même
  assert.notDeepEqual(signingSecret(master), Buffer.from(master.SALACV_MASTER_KEY, 'base64'));
  // la variable explicite garde la priorité ; sans rien, pas de session
  assert.notDeepEqual(signingSecret({ ...master, SALACV_SESSION_SECRET: 'explicite-0123456789' }), signingSecret(master));
  assert.equal(issue('zoe@example.com', {}), null);
  assert.equal(issue('zoe@example.com', { SALACV_MASTER_KEY: 'trop-court' }), null);
});

test('/api/status : seulement des oui/non, jamais une valeur ; liste ce qui manque', async () => {
  const keep = { ...process.env };
  delete process.env.SALACV_MASTER_KEY;
  delete process.env.SALACV_SESSION_SECRET;
  delete process.env.SALACV_ADMIN_UID;
  try {
    const [, bad] = await ROUTES.status();
    assert.equal(bad.ready, false);
    assert.deepEqual(bad.missing.sort(), ['SALACV_ADMIN_UID', 'SALACV_MASTER_KEY']);
    process.env.SALACV_MASTER_KEY = randomBytes(32).toString('base64');
    process.env.SALACV_ADMIN_UID = 'uid-secret-123';
    const [, good] = await ROUTES.status();
    assert.equal(good.ready, true);
    assert.deepEqual(good.missing, []);
    assert.ok(!JSON.stringify(good).includes(process.env.SALACV_MASTER_KEY) && !JSON.stringify(good).includes('uid-secret-123'), 'aucune valeur ne sort');
  } finally {
    Object.assign(process.env, keep);
  }
});
