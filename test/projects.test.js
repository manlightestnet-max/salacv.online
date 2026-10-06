// CV des comptes connectés : sauvegarde sur R2 (faux bucket signé en mémoire, aucun réseau) ou, sans R2, dans la base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { memoryDb, query } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import { projectsRoute, MAX_PROJECT_BYTES, MAX_PROJECTS } from '../server/projects.js';
import { r2Configured, userPrefix } from '../server/r2.js';
import { setSetting } from '../server/settings.js';
import { issue } from '../server/agent/auth.js';
import { render } from '../server/render.js';
import { fromResume } from '../app/state.js';
import * as credits from '../server/credits.js';

await memoryDb();
memoryStore();
const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-pour-les-tests' };
Object.assign(process.env, ENV);
const token = (u) => issue(u, ENV);

// Faux R2 : vérifie que chaque requête est signée (AWS Signature V4) et garde les objets en mémoire.
function fakeR2() {
  const objects = new Map();
  const log = [];
  const fetchImpl = async (req) => {
    const url = new URL(req.url);
    const auth = req.headers.get('authorization') ?? '';
    const key = decodeURIComponent(url.pathname);
    log.push({ method: req.method, path: key, signed: /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request/.test(auth), host: url.host });
    if (req.method === 'PUT') {
      objects.set(key, Buffer.from(await req.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : new Response('', { status: 404 });
  };
  return { objects, log, fetchImpl };
}

async function configureR2() {
  await setSetting('r2.accountId', 'compte123', ENV);
  await setSetting('r2.accessKeyId', 'AKIATEST', ENV);
  await setSetting('r2.secretAccessKey', 'secret-test-0123456789', ENV);
  await setSetting('r2.bucket', 'salacv-test', ENV);
}

const cv = (id, extra = {}) => ({ id, state: { profile: { name: 'Grace', ...extra }, template: 'minimal' }, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 });

test('sans connexion : aucune sauvegarde (401)', async () => {
  assert.equal((await projectsRoute({ action: 'list' }, '', { env: ENV }))[0], 401);
  assert.equal((await projectsRoute({ action: 'save', id: 'abcd', data: {} }, 'jeton-faux', { env: ENV }))[0], 401);
});

test('sans R2 : l’enregistrement est refusé avec un message clair (aucun repli silencieux), la liste est vide', async () => {
  assert.equal(await r2Configured(ENV), false);
  const a = token('ana@example.com');
  const [status, body] = await projectsRoute({ action: 'save', id: 'cv1abc', kind: 'cv', data: cv('cv1abc') }, a, { env: ENV });
  assert.equal(status, 503);
  assert.match(body.error, /R2/);
  const [, list] = await projectsRoute({ action: 'list' }, a, { env: ENV });
  assert.deepEqual(list, { ok: true, storage: false, items: [] });
  assert.equal((await query('SELECT count(*)::int AS n FROM projects'))[0].n, 0, 'rien n’est gardé dans la base');
});

test('validation : identifiant, type, forme, taille et nombre maximum de CV', async () => {
  await configureR2();
  const t = token('cleo@example.com');
  const r2 = fakeR2();
  const save = (p) => projectsRoute({ action: 'save', ...p }, t, { env: ENV, fetchImpl: r2.fetchImpl });
  assert.equal((await save({ id: 'A!', data: {} }))[0], 400);
  assert.equal((await save({ id: 'abcd', kind: 'virus', data: {} }))[0], 400);
  assert.equal((await save({ id: 'abcd', data: [] }))[0], 400);
  assert.equal((await save({ id: 'abcd', data: null }))[0], 400);
  const big = await save({ id: 'abcd', data: { photo: 'x'.repeat(MAX_PROJECT_BYTES) } });
  assert.equal(big[0], 413);
  assert.match(big[1].error, /trop lourd/);
  for (let i = 0; i < MAX_PROJECTS; i++) await query(`INSERT INTO projects (username, id, kind, data) VALUES ($1, $2, 'cv', '{}'::jsonb)`, ['cleo@example.com', `p${String(i).padStart(4, '0')}`]);
  const over = await save({ id: 'nouveau1', data: { a: 1 } });
  assert.equal(over[0], 400);
  assert.match(over[1].error, /limite/);
  assert.equal((await save({ id: 'p0000', data: { a: 2 } }))[0], 200); // mettre à jour un CV existant reste possible
});

test('avec R2 : le contenu part sur le bucket (requêtes signées, dossier du compte), l’index reste en base', async () => {
  await configureR2();
  assert.equal(await r2Configured(ENV), true);
  const [{ value: stored }] = await query(`SELECT value FROM settings WHERE key = 'r2.secretAccessKey'`);
  assert.ok(!stored.includes('secret-test'), 'les clés d’accès sont chiffrées en base');

  const r2 = fakeR2();
  const opts = { env: ENV, fetchImpl: r2.fetchImpl };
  const t = token('dora@example.com');
  assert.equal((await projectsRoute({ action: 'save', id: 'r2cv01', data: cv('r2cv01', { email: 'dora@example.com' }) }, t, opts))[0], 200);
  const key = `/salacv-test/${userPrefix('dora@example.com')}/cv/r2cv01.json`;
  assert.ok(r2.objects.has(key));
  assert.ok(!key.includes('dora'), 'aucune adresse e-mail dans le nom de l’objet');
  assert.ok(r2.log.every((l) => l.signed && l.host === 'compte123.r2.cloudflarestorage.com'));
  const row = (await query(`SELECT data, r2_key FROM projects WHERE username = 'dora@example.com'`))[0];
  assert.equal(row.data, null); // le contenu n'est pas dans la base
  assert.equal(row.r2_key, key.replace('/salacv-test/', ''));
  // relecture depuis R2
  const [, list] = await projectsRoute({ action: 'list' }, t, opts);
  assert.equal(list.items[0].data.state.profile.email, 'dora@example.com');
  // suppression : l'objet disparaît du bucket
  await projectsRoute({ action: 'delete', id: 'r2cv01' }, t, opts);
  assert.equal(r2.objects.has(key), false);
});

test('PDF d’un client : un PDF propre est gardé sur R2, un PDF avec filigrane jamais', async () => {
  const r2 = fakeR2();
  const real = globalThis.fetch;
  globalThis.fetch = r2.fetchImpl; // render() utilise le fetch global pour R2
  try {
    const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));
    const state = fromResume(example);
    await credits.ensureAccount('eli@example.com', ENV);
    const [, clean] = await render({ state, formats: ['pdf'] }, token('eli@example.com'), { env: ENV });
    assert.equal(clean.entitlement, 'clean');
    await new Promise((r) => setTimeout(r, 200));
    const pdfs = [...r2.objects.keys()].filter((k) => k.includes('/pdf/'));
    assert.equal(pdfs.length, 1);
    assert.equal(r2.objects.get(pdfs[0]).subarray(0, 5).toString(), '%PDF-');
    assert.ok(!pdfs[0].includes('eli@'));
    // visiteur : filigrane, rien n'est gardé
    await render({ state, formats: ['pdf'] }, '', { env: ENV, ctx: { ip: '198.51.100.5', sid: 'v', client: 'web' } });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal([...r2.objects.keys()].filter((k) => k.includes('/pdf/')).length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test('partage : un CV est privé ; rendu public, n’importe qui le lit (sans le compte du propriétaire) ; de nouveau privé, plus personne', async () => {
  await configureR2();
  const r2 = fakeR2();
  const o = { env: ENV, fetchImpl: r2.fetchImpl, ip: '10.0.0.9' };
  const owner = token('pub@example.com');
  assert.equal((await projectsRoute({ action: 'save', id: 'pubcv01', kind: 'cv', data: cv('pubcv01') }, owner, o))[0], 200);
  assert.equal((await projectsRoute({ action: 'public', id: 'pubcv01' }, '', o))[0], 404, 'privé par défaut');
  assert.equal((await projectsRoute({ action: 'share', id: 'pubcv01', public: true }, token('autre@example.com'), o))[0], 404, 'seul le propriétaire partage');
  assert.equal((await projectsRoute({ action: 'share', id: 'pubcv01', public: true }, owner, o))[0], 200);
  const [status, body] = await projectsRoute({ action: 'public', id: 'pubcv01' }, '', o);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.cv).sort(), ['docs', 'name', 'state', 'variants']);
  assert.ok(!JSON.stringify(body).includes('pub@example.com'), 'le compte du propriétaire ne sort jamais');
  const [, list] = await projectsRoute({ action: 'list' }, owner, o);
  assert.equal(list.items.find((it) => it.id === 'pubcv01').public, true);
  assert.equal((await projectsRoute({ action: 'share', id: 'pubcv01', public: false }, owner, o))[0], 200);
  assert.equal((await projectsRoute({ action: 'public', id: 'pubcv01' }, '', o))[0], 404);
});
