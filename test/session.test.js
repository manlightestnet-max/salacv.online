// Session par cookie httpOnly : le navigateur ne voit jamais le jeton ; l'app desktop le reçoit pour son coffre ; me / logout.
// Vrai serveur HTTP local, vraie base PGlite ; aucune sortie sur le réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import { createApp } from '../server/index.js';
import { issue } from '../server/agent/auth.js';
import { withSession } from '../server/http.js';

await memoryDb();
memoryStore();
Object.assign(process.env, { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_ADMIN_UID: 'uid-admin-1', SALACV_ALLOW_PASSWORD_LOGIN: '1' });
const ENV = process.env;

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const post = (path, body = {}, headers = {}) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${name}=`));

test('connexion web : cookie httpOnly posé, jeton ABSENT de la réponse (invisible du JavaScript)', async () => {
  const res = await post('login', { username: 'ines@example.com', password: 'secret123' });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.token, undefined, 'le navigateur ne reçoit jamais le jeton');
  const cookie = cookieOf(res, 'sv_session');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=604800/);
  // le cookie suffit pour être reconnu
  const me = await (await post('me', {}, { Cookie: cookie.split(';')[0] })).json();
  assert.deepEqual({ loggedIn: me.loggedIn, username: me.username, kind: me.kind }, { loggedIn: true, username: 'ines@example.com', kind: 'google' });
});

test('app desktop : le relais (qui se déclare) reçoit le jeton pour son coffre, et le renvoie en en-tête', async () => {
  const res = await post('login', { username: 'omar@example.com', password: 'secret123' }, { 'X-Salacv-Client': 'desktop' });
  const body = await res.json();
  assert.ok(body.token, 'le relais desktop reçoit le jeton');
  const me = await (await post('me', {}, { Authorization: `Bearer ${body.token}` })).json();
  assert.equal(me.loggedIn, true);
  assert.equal(me.username, 'omar@example.com');
});

test('me : visiteur, jeton falsifié, compte suspendu → non connecté', async () => {
  assert.equal((await (await post('me')).json()).loggedIn, false);
  assert.equal((await (await post('me', {}, { Cookie: 'sv_session=faux.jeton' })).json()).loggedIn, false);
  const tok = issue('bloque@example.com', ENV);
  assert.equal((await (await post('me', {}, { Cookie: `sv_session=${tok}` })).json()).loggedIn, true);
  const { query } = await import('../server/db/index.js');
  await query(`INSERT INTO users (username, blocked) VALUES ('bloque@example.com', true) ON CONFLICT (username) DO UPDATE SET blocked = true`);
  assert.equal((await (await post('me', {}, { Cookie: `sv_session=${tok}` })).json()).loggedIn, false);
});

test('logout : efface le cookie de session ET le cookie admin', async () => {
  const res = await post('logout');
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('sv_session=;') && /Max-Age=0/.test(c)));
  assert.ok(cookies.some((c) => c.startsWith('sv_admin=;') && /Max-Age=0/.test(c)));
});

test('les routes protégées lisent le cookie : crédits du compte connecté, zéro pour un visiteur', async () => {
  const tok = issue('lea@example.com', ENV);
  const mine = await (await post('credits', {}, { Cookie: `sv_session=${tok}` })).json();
  assert.equal(mine.loggedIn, true);
  assert.equal(mine.balance, 3); // cadeau d'inscription
  assert.equal((await (await post('credits')).json()).balance, 0);
});

test('admin : seul le cookie admin ouvre l’admin (le cookie de session d’un utilisateur ne suffit pas)', async () => {
  const adminTok = issue('#admin', ENV, Date.now(), 3600);
  assert.equal((await post('admin', { action: 'whoami' }, { Cookie: `sv_admin=${adminTok}` })).status, 200);
  assert.equal((await post('admin', { action: 'whoami' }, { Cookie: `sv_session=${adminTok}` })).status, 401);
  assert.equal((await post('admin', { action: 'whoami' }, { Cookie: `sv_admin=${issue('ines@example.com', ENV)}` })).status, 401);
  assert.equal((await post('admin', { action: 'whoami' })).status, 401);
});

test('withSession : durée du cookie plafonnée à 7 jours ; clé en ligne = jusqu’à sa fin de vie', async () => {
  const req = { headers: {} };
  const ctx = { client: 'web' };
  const [, , h1] = await withSession(Promise.resolve([200, { ok: true, token: 'abc', username: 'x' }]), req, ctx);
  assert.match(h1['Set-Cookie'], /Max-Age=604800/);
  const [, , h2] = await withSession(Promise.resolve([200, { ok: true, token: 'abc', expiresAt: Date.now() + 3600_000 }]), req, ctx);
  const age = Number(/Max-Age=(\d+)/.exec(h2['Set-Cookie'])[1]);
  assert.ok(age > 3500 && age <= 3600);
  // échec de connexion : aucun cookie
  const [, body, h3] = await withSession(Promise.resolve([401, { ok: false, error: 'non' }]), req, ctx);
  assert.equal(h3, undefined);
  assert.equal(body.ok, false);
});

test('mon compte : /api/me rend photo Google, date d’inscription et connexions ; une photo hors Google est ignorée', async () => {
  const { recordLogin } = await import('../server/db/users.js');
  await recordLogin('lea@example.com', { name: 'Léa', picture: 'https://lh3.googleusercontent.com/a/photo-lea=s96-c' });
  await recordLogin('lea@example.com', { picture: 'https://evil.example.com/x.png' }); // ignorée : la photo reste celle de Google
  const me = await (await post('me', {}, { Authorization: `Bearer ${issue('lea@example.com', ENV)}` })).json();
  assert.equal(me.picture, 'https://lh3.googleusercontent.com/a/photo-lea=s96-c');
  assert.equal(me.name, 'Léa');
  assert.equal(me.logins, 2);
  assert.ok(me.since > 0 && me.lastLogin >= me.since);
});
