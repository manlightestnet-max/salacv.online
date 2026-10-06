// Phrase de récupération de l'administrateur : une copie de la clé maîtresse (et du secret de session, s'il
// est défini) est gardée en base, chiffrée par une clé tirée de SA phrase (scrypt + AES-256-GCM). La phrase
// n'est jamais enregistrée : sans elle, la copie est inutilisable, même pour qui lit la base.
//
// Clé maîtresse perdue → l'admin tape sa phrase (admin, ou `node scripts/recover-master.mjs`) → il récupère
// SALACV_MASTER_KEY (et SALACV_SESSION_SECRET) à remettre dans les variables d'environnement.
import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { fingerprint } from './crypto.js';
import { store } from './store.js';

export const RECOVERY_KEY = 'masterRecovery';
export const MIN_PASSPHRASE = 12;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class RecoveryError extends Error {}

const derive = (passphrase, salt) =>
  new Promise((resolve, reject) => scrypt(String(passphrase).normalize('NFC'), salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));

// Empreinte courte de la clé maîtresse : savoir si la copie correspond à la clé en service, sans la révéler.
const keyPrint = (masterKey) => fingerprint(`salacv-master:${masterKey}`).slice(0, 16);

/** Chiffre la clé maîtresse en service (et le secret de session) avec la phrase ; remplace la copie précédente. */
export async function saveRecovery(passphrase, env = process.env, kv = store()) {
  if (!env.SALACV_MASTER_KEY) throw new RecoveryError('Aucune SALACV_MASTER_KEY en service : rien à sauvegarder.');
  if (String(passphrase ?? '').length < MIN_PASSPHRASE) throw new RecoveryError(`La phrase doit faire au moins ${MIN_PASSPHRASE} caractères.`);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(passphrase, salt);
  const plain = JSON.stringify({ masterKey: env.SALACV_MASTER_KEY, sessionSecret: env.SALACV_SESSION_SECRET || null });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const record = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    print: keyPrint(env.SALACV_MASTER_KEY),
    withSession: Boolean(env.SALACV_SESSION_SECRET),
    at: Date.now(),
  };
  await kv.set(RECOVERY_KEY, record);
  return recoveryStatus(env, kv);
}

/** Y a-t-il une copie, de quand, et correspond-elle à la clé en service ? */
export async function recoveryStatus(env = process.env, kv = store()) {
  const r = await kv.get(RECOVERY_KEY, null);
  if (!r) return { saved: false };
  const current = env.SALACV_MASTER_KEY ? keyPrint(env.SALACV_MASTER_KEY) : '';
  const same = current.length === r.print.length && timingSafeEqual(Buffer.from(current), Buffer.from(r.print));
  return { saved: true, at: r.at, current: same, withSession: r.withSession };
}

/** Rend la clé maîtresse (et le secret de session) sauvegardés, avec la bonne phrase seulement. */
export async function recoverMaster(passphrase, kv = store()) {
  const r = await kv.get(RECOVERY_KEY, null);
  if (!r) throw new RecoveryError('Aucune sauvegarde : la phrase de récupération n’a jamais été définie.');
  const key = await derive(passphrase, Buffer.from(r.salt, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(r.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(r.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(r.data, 'base64')), decipher.final()]).toString('utf8');
    return { ...JSON.parse(plain), at: r.at };
  } catch {
    throw new RecoveryError('Phrase incorrecte.');
  }
}
