// Chiffrement des secrets enregistrés par l'admin (clés d'API, clés de paiement…) : AES-256-GCM.
//
// La clé maîtresse (SALACV_MASTER_KEY, 32 octets en base64) est l'un des rares secrets d'environnement :
// sans elle, la base seule ne livre aucun secret. Génération : node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class SecretsError extends Error {}

let warned = false;
function masterKey(env) {
  const raw = env.SALACV_MASTER_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new SecretsError('SALACV_MASTER_KEY doit faire 32 octets (base64).');
    return key;
  }
  // Développement seulement : une clé fixe, avec avertissement. Jamais en production.
  if (env.VERCEL || env.NODE_ENV === 'production') throw new SecretsError('SALACV_MASTER_KEY manquante : les secrets ne peuvent pas être enregistrés.');
  if (!warned) {
    warned = true;
    console.warn('[secrets] SALACV_MASTER_KEY absente : clé de développement utilisée (jamais en production).');
  }
  return createHash('sha256').update('salacv-dev-master-key').digest();
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function seal(plain, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(env), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(data)}`;
}

export function open(blob, env = process.env) {
  const [version, iv, tag, data] = String(blob).split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new SecretsError('Secret illisible.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(env), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof SecretsError) throw err;
    throw new SecretsError('Secret illisible (clé maîtresse modifiée ou donnée altérée).');
  }
}

// Empreinte non réversible : repérer un doublon sans jamais déchiffrer.
export const fingerprint = (secret) => createHash('sha256').update(String(secret)).digest('hex');

export const last4 = (secret) => String(secret).slice(-4);
