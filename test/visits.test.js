// Visiteurs : IP masquée, appareil lu dans le user-agent, pays par l'hébergeur, robots ignorés, une visite par
// navigateur (30 min), chemin sans requête, tableau de bord de l'admin. Base en mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { device, geo, isBot, maskIp, track, visitStats } from '../server/visits.js';
import { memoryDb, query } from '../server/db/index.js';

await memoryDb();

const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0';
const req = (ua, headers = {}) => ({ headers: { 'user-agent': ua, ...headers } });

test('IP masquée, jamais entière', () => {
  assert.equal(maskIp('41.202.17.88'), '41.202.17.•');
  assert.equal(maskIp('2c0f:f8f0:1a2b:0042::/64'), '2c0f:f8f0:1a2b::•');
  assert.equal(maskIp('inconnue'), 'inconnue');
});

test('appareil, système, navigateur ; robots ; pays et ville', () => {
  assert.deepEqual(device(ANDROID), { type: 'mobile', os: 'Android', browser: 'Chrome' });
  assert.deepEqual(device(WINDOWS), { type: 'ordinateur', os: 'Windows', browser: 'Edge' });
  assert.equal(device('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1').type, 'tablette');
  assert.equal(device(WINDOWS, 'desktop').type, 'app PC');
  assert.ok(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)') && isBot('WhatsApp/2.23') && isBot(''));
  assert.ok(!isBot(ANDROID));
  assert.deepEqual(geo({ 'x-vercel-ip-country': 'cg', 'x-vercel-ip-city': 'Pointe-Noire' }), { country: 'CG', city: 'Pointe-Noire' });
  assert.deepEqual(geo({}), { country: '', city: '' });
});

test('une visite : pages, durée, source ; robots ignorés ; jamais la requête de l’adresse', async () => {
  const ctx = { ip: '41.202.17.88', sid: 'abc', client: 'web' };
  const r = req(ANDROID, { 'x-vercel-ip-country': 'CG', 'x-vercel-ip-city': 'Brazzaville' });
  await track({ type: 'view', path: '/', source: 'www.facebook.com' }, r, ctx);
  await track({ type: 'view', path: '/studio/?p=secret123' }, r, ctx);
  await track({ type: 'ping' }, r, ctx);
  assert.deepEqual(await track({ type: 'view', path: '/' }, req('Googlebot/2.1'), { ...ctx, sid: 'bot' }), { ok: true, skipped: true });

  const rows = await query('SELECT * FROM visits');
  assert.equal(rows.length, 1);
  const v = rows[0];
  assert.equal(v.ip_masked, '41.202.17.•');
  assert.equal(v.pages, 2);
  assert.deepEqual(v.paths, ['/', '/studio/']);
  assert.equal(v.source, 'facebook.com');
  assert.equal(v.country, 'CG');
  assert.ok(!JSON.stringify(rows).includes('41.202.17.88') && !JSON.stringify(rows).includes('secret123'));

  // Le même navigateur qui se connecte : la visite est rattachée à son compte.
  await track({ type: 'leave' }, r, ctx, 'ana@gmail.com');
  assert.equal((await query('SELECT username, ended_at FROM visits'))[0].username, 'ana@gmail.com');

  // Un autre navigateur (sur ordinateur) : une deuxième visite.
  await track({ type: 'view', path: '/' }, req(WINDOWS), { ip: '102.16.4.9', sid: 'def', client: 'web' });

  const s = await visitStats('today');
  assert.equal(s.totals.visitors, 2);
  assert.equal(s.totals.visits, 2);
  assert.equal(s.totals.logged, 1);
  assert.deepEqual(Object.fromEntries(s.devices.map((d) => [d.k, d.n])), { mobile: 1, ordinateur: 1 });
  assert.equal(s.pages[0].k, '/');
  assert.equal(s.recent.length, 2);
  assert.ok(s.recent.every((x) => x.ip.endsWith('•')));
});
