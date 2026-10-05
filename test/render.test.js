// Crédits, génération du CV côté serveur (filigrane, Word), avis et statistiques : vraie base Postgres (PGlite), aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { memoryDb, query } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import * as credits from '../server/credits.js';
import { render, creditsRoute } from '../server/render.js';
import { feedback, stats } from '../server/feedback.js';
import { setSetting } from '../server/settings.js';
import { issue } from '../server/agent/auth.js';
import { fromResume } from '../app/state.js';
import { admin } from '../server/admin.js';
import { ROUTES } from '../server/http.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-pour-les-tests', SALACV_ADMIN_UID: 'uid-admin-1' };
Object.assign(process.env, { SALACV_SESSION_SECRET: ENV.SALACV_SESSION_SECRET, SALACV_MASTER_KEY: ENV.SALACV_MASTER_KEY });
const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));
const stateOf = (name = 'Grace Mbuyi') => ({ ...fromResume(example), profile: { ...fromResume(example).profile, name } });
const token = (u) => issue(u, ENV);
const visitor = (n = 1) => ({ ip: `198.51.100.${n}`, sid: `visiteur-${n}`, client: 'web' });
const isPdf = (b64) => Buffer.from(b64, 'base64').subarray(0, 5).toString() === '%PDF-';
const isDocx = (b64) => Buffer.from(b64, 'base64').subarray(0, 2).toString() === 'PK';

test('crédits : cadeau d’inscription une seule fois, réglable par l’admin', async () => {
  await setSetting('grant.signupCredits', '3', ENV);
  assert.equal(await credits.ensureAccount('ana@example.com', ENV), 3);
  assert.equal(await credits.ensureAccount('ana@example.com', ENV), 3); // pas un deuxième cadeau
  const h = await credits.history('ana@example.com');
  assert.equal(h.length, 1);
  assert.equal(h[0].reason, 'Cadeau d’inscription');
  await setSetting('grant.signupCredits', '0', ENV);
  assert.equal(await credits.ensureAccount('bob@example.com', ENV), 0); // cadeau désactivé
  assert.equal((await credits.history('bob@example.com')).length, 0);
  await setSetting('grant.signupCredits', '3', ENV);
});

test('crédits : débit atomique, jamais négatif, même sous 20 demandes simultanées', async () => {
  await credits.ensureAccount('cleo@example.com', ENV); // 3 crédits
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => credits.spend('cleo@example.com', 1, 'test', `t:${i}`)));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal(await credits.balance('cleo@example.com'), 0);
  assert.equal((await credits.spend('cleo@example.com', 1, 'test', 't:encore')).ok, false);
  // même opération rejouée : pas de double débit
  await credits.add('cleo@example.com', 2, 'Achat', 'achat:1');
  await credits.add('cleo@example.com', 2, 'Achat', 'achat:1');
  assert.equal(await credits.balance('cleo@example.com'), 2);
  assert.equal((await credits.spend('cleo@example.com', 1, 'x', 'dup')).ok, true);
  assert.equal((await credits.spend('cleo@example.com', 1, 'x', 'dup')).ok, false); // même ref : refusé
  assert.equal(await credits.balance('cleo@example.com'), 1);
});

test('visiteur : PDF avec filigrane, Word bloqué, rien n’est débité ni enregistré', async () => {
  const [status, body] = await render({ state: stateOf(), formats: ['pdf', 'docx'] }, '', { env: ENV, ctx: visitor(1) });
  assert.equal(status, 200);
  assert.equal(body.entitlement, 'watermark');
  assert.equal(body.loggedIn, false);
  assert.equal(body.files.pdf.watermarked, true);
  assert.ok(isPdf(body.files.pdf.base64));
  assert.equal(body.files.docx, undefined, 'le Word ne sort jamais pour un visiteur');
  assert.match(body.blocked.docx, /connectés/);
  assert.match(body.reason, /Connecte-toi/);
  assert.equal(body.charged, false);
  // le filigrane est réellement dans le PDF : les deux versions diffèrent
  await credits.ensureAccount('dan@example.com', ENV);
  const [, clean] = await render({ state: stateOf(), formats: ['pdf'] }, token('dan@example.com'), { env: ENV });
  assert.notEqual(clean.files.pdf.base64, body.files.pdf.base64);
  assert.ok(Buffer.from(body.files.pdf.base64, 'base64').length > 1000);
});

test('compte avec crédit : PDF propre + Word, 1 crédit débité une seule fois par version', async () => {
  await credits.ensureAccount('eva@example.com', ENV);
  const t = token('eva@example.com');
  const [s1, b1] = await render({ state: stateOf('Eva Test'), formats: ['pdf', 'docx'] }, t, { env: ENV });
  assert.equal(s1, 200);
  assert.equal(b1.entitlement, 'clean');
  assert.equal(b1.charged, true);
  assert.equal(b1.balance, 2);
  assert.equal(b1.files.pdf.watermarked, false);
  assert.ok(isPdf(b1.files.pdf.base64) && isDocx(b1.files.docx.base64));
  // même version : gratuite
  const [, b2] = await render({ state: stateOf('Eva Test'), formats: ['pdf', 'docx'] }, t, { env: ENV });
  assert.equal(b2.charged, false);
  assert.equal(b2.balance, 2);
  assert.equal(b2.entitlement, 'clean');
  // version modifiée : nouvelle génération, nouveau crédit
  const [, b3] = await render({ state: stateOf('Eva Test Modifiée') }, t, { env: ENV });
  assert.equal(b3.charged, true);
  assert.equal(b3.balance, 1);
  const [, shown] = await creditsRoute(t, { env: ENV });
  assert.equal(shown.balance, 1);
  assert.deepEqual(shown.history.map((h) => h.delta), [-1, -1, 3]);
});

test('compte sans crédit : PDF avec filigrane, Word bloqué, aucun débit, aucune version « payée » enregistrée', async () => {
  await credits.ensureAccount('fred@example.com', ENV);
  await credits.spend('fred@example.com', 3, 'vidé', 'vide:fred');
  const t = token('fred@example.com');
  const [status, body] = await render({ state: stateOf('Fred'), formats: ['pdf', 'docx'] }, t, { env: ENV });
  assert.equal(status, 200);
  assert.equal(body.entitlement, 'watermark');
  assert.equal(body.files.pdf.watermarked, true);
  assert.equal(body.files.docx, undefined);
  assert.match(body.blocked.docx, /crédit/);
  assert.match(body.reason, /plus de crédit/);
  assert.equal(await credits.balance('fred@example.com'), 0);
  assert.equal(await credits.hasRendered('fred@example.com', (await query('SELECT fingerprint FROM renders WHERE username = $1', ['fred@example.com']))[0]?.fingerprint ?? 'x'), false);
  // il achète : la même version sort maintenant propre
  await credits.add('fred@example.com', 1, 'Achat', 'achat:fred');
  const [, again] = await render({ state: stateOf('Fred'), formats: ['pdf'] }, t, { env: ENV });
  assert.equal(again.entitlement, 'clean');
  assert.equal(again.charged, true);
});

test('simulation (dryRun) : annonce les droits sans rien générer ni débiter', async () => {
  await credits.ensureAccount('gina@example.com', ENV);
  const t = token('gina@example.com');
  const [, dry] = await render({ state: stateOf('Gina'), dryRun: true }, t, { env: ENV });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.entitlement, 'clean');
  assert.equal(dry.cost, 1);
  assert.equal(dry.balance, 3);
  assert.equal(dry.files, undefined);
  assert.equal(await credits.balance('gina@example.com'), 3);
  const [, dryVisitor] = await render({ state: stateOf('Gina'), dryRun: true }, '', { env: ENV, ctx: visitor(2) });
  assert.equal(dryVisitor.entitlement, 'watermark');
  assert.equal(dryVisitor.wordAllowed, false);
});

test('génération : refus propres (nom manquant, état absent, session expirée, compte suspendu, trop de demandes)', async () => {
  const ctx = visitor(3);
  assert.equal((await render({ state: stateOf('') }, '', { env: ENV, ctx }))[0], 400);
  assert.equal((await render({}, '', { env: ENV, ctx }))[0], 400);
  assert.equal((await render({ state: stateOf() }, 'jeton-invalide', { env: ENV, ctx }))[0], 401);
  assert.equal((await render({ state: stateOf() }, ''))[0], 400); // ni jeton ni contexte
  await query(`INSERT INTO users (username, blocked) VALUES ('hugo@example.com', true) ON CONFLICT (username) DO UPDATE SET blocked = true`);
  assert.equal((await render({ state: stateOf() }, token('hugo@example.com'), { env: ENV }))[0], 403);
  let last;
  for (let i = 0; i < 12; i++) last = await render({ state: stateOf(), dryRun: true }, '', { env: ENV, ctx: visitor(9) });
  assert.equal(last[0], 429);
});

test('avis : un par personne, modifiable, plafonné par IP, intégré aux statistiques publiques', async () => {
  assert.deepEqual(await stats().then((s) => s.rating), null); // aucun avis : rien d'inventé
  const a = visitor(21);
  const [s1, r1] = await feedback({ stars: 5, comment: 'Super !' }, '', { env: ENV, ctx: a });
  assert.equal(s1, 200);
  assert.equal(r1.rating.count, 1);
  assert.equal(r1.rating.average, 5);
  // même session : remplace son avis
  const [, r2] = await feedback({ stars: 3 }, '', { env: ENV, ctx: a });
  assert.equal(r2.rating.count, 1);
  assert.equal(r2.rating.average, 3);
  // un compte connecté : son propre avis
  const [, r3] = await feedback({ stars: 5, comment: 'Top' }, token('iris@example.com'), { env: ENV, ctx: visitor(22) });
  assert.equal(r3.rating.count, 2);
  assert.equal(r3.rating.average, 4);
  assert.equal((await feedback({ stars: 9 }, '', { env: ENV, ctx: a }))[0], 400);
  assert.equal((await feedback({ stars: 0 }, '', { env: ENV, ctx: a }))[0], 400);
  // une même IP ne fabrique pas des avis en effaçant ses cookies : 5 nouveaux avis par jour au plus
  const results = [];
  for (let i = 0; i < 7; i++) results.push((await feedback({ stars: 1 }, '', { env: ENV, ctx: { ip: '198.51.100.99', sid: `faux-${i}`, client: 'web' } }))[0]);
  assert.deepEqual(results, [200, 200, 200, 200, 200, 429, 429]);
  assert.ok(!JSON.stringify(await query('SELECT * FROM feedback')).includes('198.51.100.99'), 'l’IP n’est jamais gardée en clair');
  // commentaire tronqué
  await feedback({ stars: 4, comment: 'x'.repeat(900) }, '', { env: ENV, ctx: visitor(23) });
  assert.equal((await query(`SELECT length(comment) AS n FROM feedback WHERE subject = 'sid:visiteur-23'`))[0].n, 500);
});

test('statistiques publiques : CV générés comptés, aucune donnée personnelle', async () => {
  const [, body] = await ROUTES.stats();
  assert.equal(body.ok, true);
  assert.ok(body.cvs >= 4, 'les générations réelles sont comptées');
  assert.ok(body.rating.count >= 2);
  assert.deepEqual(Object.keys(body).sort(), ['cvs', 'ok', 'rating']);
});

test('admin : cadeau d’inscription modifiable depuis l’interface', async () => {
  const adm = (await admin({ action: 'login', idToken: 'x' }, '', ENV, { verifyToken: async () => ({ uid: 'uid-admin-1', email: 'a@b.c', name: '' }) }))[1].token;
  assert.equal((await admin({ action: 'setSetting', key: 'grant.signupCredits', value: '5' }, adm, ENV))[0], 200);
  assert.equal(await credits.ensureAccount('jade@example.com', ENV), 5);
  assert.equal((await admin({ action: 'setSetting', key: 'grant.signupCredits', value: '-1' }, adm, ENV))[0], 400);
  await setSetting('grant.signupCredits', '3', ENV);
});
