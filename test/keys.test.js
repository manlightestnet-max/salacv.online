// Clés IA (pool de l'admin, attribution à un client), rotation, accès à l'IA, réglages et chiffrement : sur une vraie base Postgres
// (PGlite en mémoire) ; aucun réseau, aucune vraie clé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb, query } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import { open, seal } from '../server/crypto.js';
import { getSetting, listSettings, setSetting } from '../server/settings.js';
import { getUser, listUsers, recordLogin, setAiAccess, setBlocked } from '../server/db/users.js';
import { addKey, assignKey, keySourceFor, listKeys, setKeyDisabled } from '../server/keys/pool.js';
import { callLLM, LLMError } from '../server/agent/llm/client.js';
import { admin } from '../server/admin.js';
import { configRoute } from '../server/keys/routes.js';
import { issue } from '../server/agent/auth.js';
import * as web from '../server/agent/web.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-pour-les-tests', SALACV_ADMIN_PASSWORD: 'admin-pass-1' };
const token = (username) => issue(username, ENV);
const SK = (n) => `sk-test-${String(n).padStart(2, '0')}-abcdefghijklmnop`; // clés factices, jamais de vraie clé

test('chiffrement : aller-retour, jamais en clair, altération et mauvaise clé maîtresse détectées', () => {
  const blob = seal('ma-cle-secrete-1234', ENV);
  assert.ok(!blob.includes('ma-cle-secrete'));
  assert.equal(open(blob, ENV), 'ma-cle-secrete-1234');
  assert.notEqual(seal('x'.repeat(10), ENV), seal('x'.repeat(10), ENV)); // vecteur d'initialisation différent à chaque fois
  const tampered = blob.slice(0, -2) + (blob.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => open(tampered, ENV), /illisible/);
  assert.throws(() => open(blob, { SALACV_MASTER_KEY: randomBytes(32).toString('base64') }), /illisible/);
  assert.throws(() => seal('x', { SALACV_MASTER_KEY: 'trop-court', VERCEL: '1' }), /32 octets/);
  assert.throws(() => seal('x', { VERCEL: '1' }), /manquante/); // jamais de clé de développement en production
});

test('comptes : accès IA accordé à la connexion, blocage sans écraser, mises à jour atomiques', async () => {
  const first = await recordLogin('grace@example.com', { name: 'Grace' });
  assert.deepEqual(first, { blocked: false, aiAccess: true });
  await Promise.all(Array.from({ length: 10 }, () => recordLogin('grace@example.com'))); // 10 connexions en même temps
  const u = await getUser('grace@example.com');
  assert.equal(u.logins, 11);
  assert.equal(u.name, 'Grace');
  await setBlocked('grace@example.com', true, 'abus');
  assert.equal((await recordLogin('grace@example.com')).blocked, true);
  assert.equal((await getUser('grace@example.com')).logins, 11); // un compte bloqué n'est pas modifié
  await setBlocked('grace@example.com', false);
  await setAiAccess('grace@example.com', false);
  assert.equal((await getUser('grace@example.com')).aiAccess, false);
  await setAiAccess('grace@example.com', true);
  assert.equal(await setAiAccess('inconnu@example.com', true), false);
  assert.ok((await listUsers()).some((x) => x.username === 'grace@example.com'));
});

test('clés : chiffrées en base, doublons et formats refusés, jamais renvoyées en clair', async () => {
  const k = await addKey({ provider: 'ollama', secret: SK(1), label: 'pool 1', createdBy: '#admin' }, ENV);
  assert.equal(k.last4, SK(1).slice(-4));
  assert.equal(k.owner, null);
  const [raw] = await query('SELECT secret_enc FROM api_keys WHERE id = $1', [k.id]);
  assert.ok(!raw.secret_enc.includes('sk-test'), 'la clé ne doit pas être en clair en base');
  assert.equal(open(raw.secret_enc, ENV), SK(1));
  assert.ok(!JSON.stringify(await listKeys()).includes('sk-test'), 'la liste ne doit jamais contenir la clé');
  await assert.rejects(addKey({ provider: 'ollama', secret: SK(1), createdBy: 'x' }, ENV), /existe déjà/);
  await assert.rejects(addKey({ provider: 'inconnu', secret: SK(2), createdBy: 'x' }, ENV), /Fournisseur inconnu/);
  await assert.rejects(addKey({ provider: 'ollama', secret: 'court', createdBy: 'x' }, ENV), /Clé invalide/);
  await assert.rejects(addKey({ provider: 'ollama', secret: 'avec des espaces ici', createdBy: 'x' }, ENV), /Clé invalide/);
});

test('rotation : première clé utilisable, épuisée sur 429 (persisté), invalide sur 401 (désactivée)', async () => {
  await query('DELETE FROM api_keys');
  const a = await addKey({ provider: 'ollama', secret: SK(10), createdBy: '#admin' }, ENV);
  const b = await addKey({ provider: 'ollama', secret: SK(11), createdBy: '#admin' }, ENV);
  const c = await addKey({ provider: 'gemini', secret: SK(12), createdBy: '#admin' }, ENV);

  // scénario : A → 429, B → 401, C → 200
  const used = [];
  const fetchImpl = async (url, init) => {
    const bearer = init.headers.Authorization.replace('Bearer ', '');
    used.push(bearer);
    if (bearer === SK(10)) return new Response('quota', { status: 429 });
    if (bearer === SK(11)) return new Response('no', { status: 401 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const src = await keySourceFor('personne@example.com', ENV);
  assert.equal(src.mode, 'pool');
  const res = await callLLM([{ role: 'user', content: 'x' }], [], { keySource: src, fetchImpl, env: ENV });
  assert.equal(res.choices[0].message.content, 'ok');
  assert.deepEqual(used, [SK(10), SK(11), SK(12)]);
  assert.equal(src.lastUsedId, c.id);

  const keys = Object.fromEntries((await listKeys()).map((k) => [k.id, k]));
  assert.equal(keys[a.id].exhaustedToday, true); // épuisée aujourd'hui : toutes les instances le savent
  assert.equal(keys[b.id].disabled, true);
  assert.match(keys[b.id].disabledReason, /401/);
  // requête suivante : A (épuisée) et B (désactivée) sont ignorées d'emblée
  used.length = 0;
  await callLLM([{ role: 'user', content: 'x' }], [], { keySource: await keySourceFor('personne@example.com', ENV), fetchImpl, env: ENV });
  assert.deepEqual(used, [SK(12)]);
  // réactiver B et la remettre en service
  await setKeyDisabled(b.id, false);
  assert.equal((await keySourceFor('autre@example.com', ENV)).next().key, SK(11));
});

test('règle stricte : un client à qui l’admin a attribué des clés ne consomme QUE celles-là, jamais le pool', async () => {
  await query('DELETE FROM api_keys');
  await addKey({ provider: 'ollama', secret: SK(20), label: 'pool', createdBy: '#admin' }, ENV);
  const mine = await addKey({ provider: 'ollama', secret: SK(21), owner: 'marie@example.com', createdBy: '#admin' }, ENV); // attribuée par l'admin

  const marie = await keySourceFor('marie@example.com', ENV);
  assert.equal(marie.mode, 'own');
  assert.deepEqual(marie.secrets(), [SK(21)]); // le secret du pool n'apparaît même pas
  assert.equal(marie.next().key, SK(21));
  // sa clé épuisée : plus rien, JAMAIS de bascule sur le pool
  await marie.exhaust(marie.next());
  assert.equal(marie.next(), null);
  const again = await keySourceFor('marie@example.com', ENV);
  assert.equal(again.next(), null);
  await assert.rejects(callLLM([], [], { keySource: again, env: ENV, fetchImpl: async () => { throw new Error('ne doit pas être appelé'); } }), (e) => e instanceof LLMError && /contacte salacv/.test(e.userMessage));
  // un autre utilisateur, sans clé, utilise le pool
  assert.equal((await keySourceFor('paul@example.com', ENV)).next().key, SK(20));
  // la clé désactivée de Marie ne la renvoie pas vers le pool non plus
  await setKeyDisabled(mine.id, true);
  assert.equal((await keySourceFor('marie@example.com', ENV)).next(), null);
});

test('attribution : l’admin attribue x clés à x utilisateurs, ou les remet dans le pool', async () => {
  await query('DELETE FROM api_keys');
  const k1 = await addKey({ provider: 'ollama', secret: SK(30), createdBy: '#admin' }, ENV);
  const k2 = await addKey({ provider: 'gemini', secret: SK(31), createdBy: '#admin' }, ENV);
  await assignKey(k1.id, 'luc@example.com');
  await assignKey(k2.id, 'luc@example.com');
  const luc = await keySourceFor('luc@example.com', ENV);
  assert.equal(luc.mode, 'own');
  assert.deepEqual(luc.secrets(), [SK(30), SK(31)]); // ordre des fournisseurs : ollama puis gemini
  assert.equal((await keySourceFor('autre@example.com', ENV)).next(), null); // le pool est vide, et sans clés d'environnement
  const back = await assignKey(k1.id, null);
  assert.equal(back.owner, null);
  assert.equal((await keySourceFor('autre@example.com', ENV)).next().key, SK(30));
  assert.equal((await keySourceFor('luc@example.com', ENV)).secrets().length, 1);
  await assert.rejects(assignKey(99999, 'x'), /introuvable/);
});

test('pool vide : les clés d’environnement servent de secours (démarrage, développement)', async () => {
  await query('DELETE FROM api_keys');
  const src = await keySourceFor('nouveau@example.com', { ...ENV, OLLAMA_API_KEY: SK(40) });
  assert.equal(src.mode, 'env');
  assert.equal(src.next().key, SK(40));
});

test('admin : clés du pool et attribution depuis son interface, sans jamais montrer un secret', async () => {
  await query('DELETE FROM api_keys');
  const adm = (await admin({ action: 'login', password: 'admin-pass-1' }, '', ENV))[1].token;
  assert.equal((await admin({ action: 'keys' }, '', ENV))[0], 401);
  assert.equal((await admin({ action: 'keys' }, token('ines@example.com'), ENV))[0], 401); // un utilisateur n'est pas admin
  const [st, added] = await admin({ action: 'addKey', provider: 'ollama', key: SK(70), label: 'principale' }, adm, ENV);
  assert.equal(st, 200);
  assert.equal(added.key.owner, null);
  assert.equal((await admin({ action: 'addKey', provider: 'ollama', key: SK(70) }, adm, ENV))[0], 400); // doublon
  assert.equal((await admin({ action: 'addKey', provider: 'ollama', key: SK(71), owner: 'inconnu@x.y' }, adm, ENV))[0], 404);
  await recordLogin('nina@example.com');
  assert.equal((await admin({ action: 'addKey', provider: 'gemini', key: SK(72), owner: 'nina@example.com' }, adm, ENV))[0], 200);
  const [, overview] = await admin({ action: 'keys' }, adm, ENV);
  assert.equal(overview.keys.length, 2);
  assert.ok(!JSON.stringify(overview).includes('sk-test'));
  assert.ok(overview.providers.includes('ollama'));
  assert.ok(overview.settings.some((s) => s.key === 'firebase.projectId'));
  assert.equal((await admin({ action: 'assignKey', id: added.key.id, username: 'nina@example.com' }, adm, ENV))[0], 200);
  assert.equal((await admin({ action: 'setKeyDisabled', id: added.key.id, disabled: true }, adm, ENV))[0], 200);
  assert.equal((await admin({ action: 'deleteKey', id: added.key.id }, adm, ENV))[0], 200);
  assert.equal((await admin({ action: 'deleteKey', id: added.key.id }, adm, ENV))[0], 400); // déjà supprimée
  // journal : aucune clé en clair
  const [, journal] = await admin({ action: 'journal' }, adm, ENV);
  assert.ok(!JSON.stringify(journal).includes('sk-test'));
});

test('réglages : secrets chiffrés et masqués, valeurs publiques servies au site sans connexion', async () => {
  const adm = (await admin({ action: 'login', password: 'admin-pass-1' }, '', ENV))[1].token;
  assert.equal((await admin({ action: 'setSetting', key: 'inconnu', value: 'x' }, adm, ENV))[0], 400);
  await setSetting('firebase.apiKey', 'AIzaFAUXpourTest', ENV);
  assert.equal(await getSetting('firebase.apiKey', ENV), 'AIzaFAUXpourTest');
  const cfg = (await configRoute(ENV))[1].config;
  assert.equal(cfg['firebase.apiKey'], 'AIzaFAUXpourTest');
  assert.equal(cfg['firebase.projectId'], 'lightpay-a5f01');
  assert.equal((await listSettings(ENV)).find((s) => s.key === 'firebase.authDomain').set, false);
});

test('accès à l’IA : connexion obligatoire, accès retirable, message clair pour qui n’a plus de clé valide', async () => {
  await query('DELETE FROM api_keys');
  await recordLogin('sara@example.com');
  const t = token('sara@example.com');
  const ok = async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'final_answer', arguments: JSON.stringify({ message: 'Bonjour' }) } }] } }] });
  // sans connexion
  assert.equal((await web.agent({ message: 'x', state: {} }, '', { env: ENV, callModel: ok }))[0], 401);
  assert.equal((await web.translate({ to: 'en', state: {} }, '', { env: ENV, callModel: ok }))[0], 401);
  // connectée : accès accordé d'office
  assert.equal((await web.agent({ message: 'x', state: {} }, t, { env: ENV, callModel: ok }))[0], 200);
  // l'admin retire l'accès IA : refus net, le compte reste actif
  await setAiAccess('sara@example.com', false);
  const [status, body] = await web.agent({ message: 'x', state: {} }, t, { env: ENV, callModel: ok });
  assert.equal(status, 403);
  assert.match(body.error, /accès à l'assistant a été retiré/);
  assert.equal((await web.translate({ to: 'en', state: {} }, t, { env: ENV, callModel: ok }))[0], 403);
  await setAiAccess('sara@example.com', true);
  assert.equal((await web.agent({ message: 'x', state: {} }, t, { env: ENV, callModel: ok }))[0], 200);
});

test('journal d’usage : chaque appel de l’IA est noté (prêt pour les futurs quotas)', async () => {
  await query('DELETE FROM api_keys');
  await query('DELETE FROM ai_usage');
  await recordLogin('omar@example.com');
  const k = await addKey({ provider: 'ollama', secret: SK(80), owner: 'omar@example.com', createdBy: '#admin' }, ENV);
  const t = token('omar@example.com');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'final_answer', arguments: JSON.stringify({ message: 'Salut' }) } }] } }] }), { status: 200 });
  try {
    const [status] = await web.agent({ message: 'bonjour', state: {} }, t, { env: ENV });
    assert.equal(status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  await new Promise((r) => setTimeout(r, 100)); // le journal s'écrit sans faire attendre la réponse
  const rows = await query('SELECT username, key_id, kind, ok FROM ai_usage');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'omar@example.com');
  assert.equal(Number(rows[0].key_id), k.id);
  assert.equal(rows[0].kind, 'agent');
  assert.equal(rows[0].ok, true);
});
