// Connexion fictive (pas de base de données) : nom d'utilisateur + mot de passe → jeton signé.
//
// Le jeton est signé côté serveur (HMAC-SHA256) : sans lui, l'agent refuse. La clé de signature
// est SALACV_SESSION_SECRET si elle existe, sinon elle est dérivée de la clé de l'agent, pour
// qu'aujourd'hui une seule variable suffise (OLLAMA_API_KEY).
//
// Si SALACV_DEMO_PASSWORD est défini, seul ce mot de passe est accepté (accès réservé aux
// testeurs) ; sinon tout couple valide ouvre une session de démonstration.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { allKeys } from './llm/providers.js';

export const TTL = 7 * 24 * 3600;
const USERNAME = /^[\p{L}\p{N}._@-]{3,40}$/u;

function secret(env) {
  if (env.SALACV_SESSION_SECRET) return Buffer.from(env.SALACV_SESSION_SECRET);
  const keys = allKeys(env).sort();
  return keys.length ? createHash('sha256').update(`salacv-session:${keys[0]}`).digest() : null;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (key, body) => b64(createHmac('sha256', key).update(body).digest());

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Message d'erreur, ou null si la connexion est acceptée.
export function checkCredentials(username, password, env = process.env) {
  if (!USERNAME.test(username ?? '')) return "Nom d'utilisateur : 3 à 40 caractères, sans espace.";
  if (String(password ?? '').length < 6) return 'Mot de passe : 6 caractères minimum.';
  if (env.SALACV_DEMO_PASSWORD && !same(password, env.SALACV_DEMO_PASSWORD)) return "Nom d'utilisateur ou mot de passe incorrect.";
  return null;
}

export function issue(username, env = process.env, now = Date.now()) {
  const key = secret(env);
  if (!key) return null;
  const body = b64(JSON.stringify({ u: username, exp: Math.floor(now / 1000) + TTL }));
  return `${body}.${sign(key, body)}`;
}

// Nom d'utilisateur si le jeton est valide et non expiré, sinon null.
export function verify(token, env = process.env, now = Date.now()) {
  const key = secret(env);
  if (!key || typeof token !== 'string' || token.split('.').length !== 2) return null;
  const [body, sig] = token.split('.');
  if (!same(sig, sign(key, body))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return data.exp > now / 1000 ? data.u : null;
  } catch {
    return null;
  }
}
