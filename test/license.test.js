// Clés KEYGEN et connexion Google : tout en local (paires de clés créées pour le test, aucun réseau).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { generateOfflineKey, parseOfflineKey } from '../src/license/offline.js';
import { createLicense } from '../src/license/activation.js';
import { activateOnlineKey, createOnlineKeys, revokeOnlineKey } from '../server/accounts/keys.js';
import { verifyFirebaseIdToken } from '../server/accounts/firebase.js';
import { googleLogin, keyLogin, loginLimiter } from '../server/agent/web.js';
import { verify } from '../server/agent/auth.js';
import { memoryStore } from '../server/store.js';

const s = memoryStore();
const ENV = { OLLAMA_API_KEY: 'cle-de-test-abcdef123456' };
const DAY = 86400000;

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};

test('clé hors ligne : générée, puis vérifiée avec la clé publique', () => {
  const { pem, pub } = pair();
  const key = generateOfflineKey(pem, { now: 1_700_000_000_000 });
  assert.match(key, /^SCVO-[A-Z2-7]{6}(-[A-Z2-7]{1,6})+$/);
  const r = parseOfflineKey(key, pub);
  assert.equal(r.ok, true);
  assert.equal(r.issuedAt, 1_700_000_000_000);
  assert.match(r.id, /^[0-9a-f]{16}$/);
  // tolère espaces, minuscules et tirets absents (copier-coller)
  assert.equal(parseOfflineKey(key.toLowerCase().replaceAll('-', ' '), pub).ok, true);
});

test('clé hors ligne : falsifiée, d’une autre paire ou sans clé publique → refusée', () => {
  const a = pair();
  const b = pair();
  const key = generateOfflineKey(a.pem);
  assert.equal(parseOfflineKey(key, b.pub).ok, false); // autre paire
  const forged = key.slice(0, 12) + (key[12] === 'A' ? 'B' : 'A') + key.slice(13);
  assert.equal(parseOfflineKey(forged, a.pub).ok, false); // un caractère changé
  assert.equal(parseOfflineKey(key, '').ok, false); // clé publique non configurée
  assert.equal(parseOfflineKey('SCVN-AAAAA-AAAAA-AAAAA-AAAAA', a.pub).ok, false); // clé en ligne
  assert.equal(parseOfflineKey('', a.pub).ok, false);
});

test('clé en ligne : l’empreinte seule est gardée, la durée démarre à l’activation, un seul appareil', async () => {
  const [key] = await createOnlineKeys(1, 'test', { s, now: 1000 });
  assert.match(key, /^SCVN-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/);
  assert.ok(!JSON.stringify(await s.get('keys', {})).includes(key), 'la clé en clair ne doit pas être stockée');
  const start = 5 * DAY;
  const first = await activateOnlineKey(key, 'appareil-numero-1', { s, now: start, days: 30 });
  assert.equal(first[0], 200);
  assert.equal(first[1].expiresAt, start + 30 * DAY);
  // même appareil, plus tard : la fin ne bouge pas
  const again = await activateOnlineKey(key.toLowerCase(), 'appareil-numero-1', { s, now: start + 10 * DAY, days: 30 });
  assert.equal(again[1].expiresAt, start + 30 * DAY);
  // autre appareil : refusé
  assert.equal((await activateOnlineKey(key, 'appareil-numero-2', { s, now: start + DAY, days: 30 }))[0], 403);
  // expirée
  assert.equal((await activateOnlineKey(key, 'appareil-numero-1', { s, now: start + 31 * DAY, days: 30 }))[1].error, 'Cette clé a expiré.');
});

test('clé en ligne : inconnue, mal formée, durée non définie, révoquée', async () => {
  const [key] = await createOnlineKeys(1, '', { s });
  assert.equal((await activateOnlineKey('SCVN-AAAAA-AAAAA-AAAAA-AAAAA', 'appareil-numero-1', { s, days: 30 }))[0], 404);
  assert.equal((await activateOnlineKey('n’importe quoi', 'appareil-numero-1', { s, days: 30 }))[0], 400);
  assert.equal((await activateOnlineKey(key, 'appareil-numero-1', { s, days: null }))[0], 503); // on ne devine pas la durée
  assert.equal((await activateOnlineKey(key, 'appareil-numero-1', { s, days: 30 }))[0], 200);
  assert.equal(await revokeOnlineKey(key, { s }), true);
  assert.equal((await activateOnlineKey(key, 'appareil-numero-1', { s, days: 30 }))[1].error, 'Cette clé a été révoquée.');
});

test('connexion par clé : la session ne dépasse jamais la fin de vie de la clé', async () => {
  loginLimiter.hits.clear();
  const [key] = await createOnlineKeys(1, '', { s });
  // durée non définie (valeur par défaut de l'app) → refus net, pas de session
  const none = await keyLogin({ key, device: 'appareil-numero-1' }, 'ip', ENV);
  assert.equal(none[0], 503);
  assert.equal(none[1].token, undefined);
});

test('jeton Firebase : accepté seulement si émetteur, audience et signature sont bons', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const env = { FIREBASE_PROJECT_ID: 'projet-test' };
  const mint = (claims = {}, { iss = 'https://securetoken.google.com/projet-test', aud = 'projet-test', key = privateKey, exp = '1h' } = {}) =>
    new SignJWT({ email: 'Grace@Example.com', email_verified: true, name: 'Grace', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('uid-123')
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(key);

  const ok = await verifyFirebaseIdToken(await mint(), env, { jwks });
  assert.deepEqual({ uid: ok.uid, email: ok.email, name: ok.name }, { uid: 'uid-123', email: 'grace@example.com', name: 'Grace' });
  assert.equal(await verifyFirebaseIdToken(await mint({}, { aud: 'autre-projet' }), env, { jwks }), null);
  assert.equal(await verifyFirebaseIdToken(await mint({}, { iss: 'https://securetoken.google.com/autre' }), env, { jwks }), null);
  assert.equal(await verifyFirebaseIdToken(await mint({ email_verified: false }), env, { jwks }), null);
  assert.equal(await verifyFirebaseIdToken(await mint({}, { key: (await generateKeyPair('RS256')).privateKey }), env, { jwks }), null);
  assert.equal(await verifyFirebaseIdToken('pas-un-jeton', env, { jwks }), null);
});

test('connexion Google : jeton vérifié → session ; jeton refusé → 401', async () => {
  loginLimiter.hits.clear();
  const good = async () => ({ uid: 'u1', email: 'grace@example.com', name: 'Grace', picture: '' });
  const bad = async () => null;
  const [status, body] = await googleLogin({ idToken: 'x' }, 'ip-a', ENV, { verifyToken: good });
  assert.equal(status, 200);
  assert.equal(body.kind, 'google');
  assert.equal(verify(body.token, ENV), 'grace@example.com');
  assert.equal((await googleLogin({ idToken: 'x' }, 'ip-b', ENV, { verifyToken: bad }))[0], 401);
});

test('connexion par clé : durée définie → session plafonnée à la fin de vie de la clé', async () => {
  loginLimiter.hits.clear();
  const [key] = await createOnlineKeys(1, '', { s });
  const now = 10 * DAY;
  const [status, body] = await keyLogin({ key, device: 'appareil-numero-1' }, 'ip-k', ENV, now, { days: 2 });
  assert.equal(status, 200);
  assert.equal(body.kind, 'key');
  assert.equal(body.expiresAt, now + 2 * DAY);
  assert.equal(verify(body.token, ENV, now + DAY), body.username); // encore valide à mi-vie
  assert.equal(verify(body.token, ENV, now + 3 * DAY), null); // jamais au-delà de la fin de la clé
});

function memoryStorage() {
  let data = null;
  return { read: () => data && structuredClone(data), write: (d) => void (data = structuredClone(d)) };
}

test('activation hors ligne : démarre à la première activation, ne repart jamais de zéro, horloge surveillée', async () => {
  const { pem, pub } = pair();
  const key = generateOfflineKey(pem);
  let clock = 100 * DAY;
  const lic = createLicense({ storage: memoryStorage(), publicKey: pub, now: () => clock, days: () => 30 });

  assert.equal((await lic.status()).state, 'none');
  const first = await lic.activate(key);
  assert.equal(first.ok, true);
  assert.equal(first.expiresAt, 130 * DAY);
  assert.equal(first.daysLeft, 30);

  clock += 10 * DAY;
  assert.equal((await lic.status()).daysLeft, 20);
  // ressaisir la même clé ne prolonge rien
  assert.equal((await lic.activate(key)).expiresAt, 130 * DAY);
  // l'effacer puis la ressaisir non plus
  await lic.clear();
  assert.equal((await lic.status()).state, 'none');
  assert.equal((await lic.activate(key)).expiresAt, 130 * DAY);

  // reculer l'horloge est détecté
  clock -= 20 * DAY;
  assert.equal((await lic.status()).state, 'clock');
  clock = 131 * DAY;
  assert.equal((await lic.status()).state, 'expired');
  assert.equal((await lic.activate(key)).ok, false);
});

test('activation hors ligne : durée non définie ou clé invalide → refus', async () => {
  const { pem, pub } = pair();
  const lic = createLicense({ storage: memoryStorage(), publicKey: pub, days: () => null });
  assert.match((await lic.activate(generateOfflineKey(pem))).error, /durée de vie/);
  const ok = createLicense({ storage: memoryStorage(), publicKey: pub, days: () => 30 });
  assert.equal((await ok.activate('SCVO-FAUSSE')).ok, false);
});
