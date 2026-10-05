// Cloudflare R2 (stockage d'objets compatible S3) : les CV des comptes connectés et leurs PDF.
// Tout se règle dans l'interface admin (Clés IA → Stockage R2) : identifiant de compte, clés d'accès (chiffrées en base),
// nom du bucket. Les requêtes sont signées (AWS Signature V4, région « auto ») avec aws4fetch.
//
// Les clés d'objet ne contiennent jamais d'adresse e-mail : u/<empreinte du compte>/…
import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { getSetting } from './settings.js';

// Nom d'objet stable et anonyme pour un compte.
export const userPrefix = (username) => `u/${createHash('sha256').update(`salacv-r2|${username}`).digest('hex').slice(0, 24)}`;

export async function r2Config(env = process.env) {
  const [accountId, accessKeyId, secretAccessKey, bucket] = await Promise.all(['r2.accountId', 'r2.accessKeyId', 'r2.secretAccessKey', 'r2.bucket'].map((k) => getSetting(k, env)));
  return accountId && accessKeyId && secretAccessKey && bucket ? { accountId, accessKeyId, secretAccessKey, bucket } : null;
}

export const r2Configured = async (env = process.env) => Boolean(await r2Config(env));

// fetchImpl est injectable (tests : un faux bucket en mémoire, aucun réseau).
async function call(method, key, { body, contentType, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = await r2Config(env);
  if (!cfg) throw new Error('R2 non configuré');
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto' });
  const url = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  // Requête signée (SigV4) puis envoyée avec fetchImpl : en test, un faux bucket remplace le réseau.
  const signed = await client.sign(url, { method, body, headers: contentType ? { 'Content-Type': contentType } : {} });
  return fetchImpl(signed, { signal: AbortSignal.timeout(20_000) });
}

export async function r2Put(key, body, contentType, opts = {}) {
  const res = await call('PUT', key, { ...opts, body, contentType });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
}

export async function r2Get(key, opts = {}) {
  const res = await call('GET', key, opts);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function r2Delete(key, opts = {}) {
  const res = await call('DELETE', key, opts);
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
}
