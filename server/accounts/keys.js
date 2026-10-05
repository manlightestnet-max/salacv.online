// Clés KEYGEN « en ligne » : un code opaque, sans rien dedans. Tout est côté serveur
// (création, activation, appareil, durée de vie, révocation) : la clé ne vaut que ce que le serveur en dit.
//
//   SCVN-XXXXX-XXXXX-XXXXX-XXXXX    (20 caractères base32 aléatoires, 100 bits)
//
// On ne garde que l'empreinte (SHA-256) de chaque clé : une fuite de la base ne donne aucune clé.
import { createHash, randomBytes } from 'node:crypto';
import { toBase32 } from '../../src/license/offline.js';
import { lifetimeDays } from '../../src/license/config.js';
import { store } from '../store.js';

export const ONLINE_PREFIX = 'SCVN';
const FORMAT = /^SCVN-[A-Z2-7]{5}(-[A-Z2-7]{5}){3}$/;
const DAY = 86400000;

export const hashKey = (key) => createHash('sha256').update(key).digest('hex');
export const normalizeKey = (key) => String(key ?? '').trim().toUpperCase().replace(/\s+/g, '');

export function generateOnlineKey() {
  const chars = toBase32(randomBytes(13)).slice(0, 20);
  return `${ONLINE_PREFIX}-${chars.match(/.{5}/g).join('-')}`;
}

// Crée `count` clés ; retourne les clés en clair (la seule fois où elles existent) ; la base n'en garde que l'empreinte.
export async function createOnlineKeys(count, note = '', { s = store(), now = Date.now() } = {}) {
  const keys = await s.get('keys', {});
  const made = [];
  for (let i = 0; i < count; i += 1) {
    const key = generateOnlineKey();
    keys[hashKey(key)] = { createdAt: now, note: String(note).slice(0, 80) };
    made.push(key);
  }
  await s.set('keys', keys);
  return made;
}

export async function revokeOnlineKey(raw, { s = store() } = {}) {
  const keys = await s.get('keys', {});
  const entry = keys[hashKey(normalizeKey(raw))];
  if (!entry) return false;
  entry.revoked = true;
  await s.set('keys', keys);
  return true;
}

// Première activation : la durée de vie démarre et la clé se lie à l'appareil. Ensuite : même appareil seulement.
// → [statut HTTP, corps]
export async function activateOnlineKey(raw, device, { s = store(), now = Date.now(), days = lifetimeDays('online') } = {}) {
  const key = normalizeKey(raw);
  if (!FORMAT.test(key)) return [400, { ok: false, error: 'Clé invalide.' }];
  if (!days) return [503, { ok: false, error: 'La durée de vie des clés n’est pas encore définie.' }];
  const deviceId = String(device ?? '');
  if (deviceId.length < 8 || deviceId.length > 100) return [400, { ok: false, error: 'Appareil non reconnu.' }];
  const keys = await s.get('keys', {});
  const hash = hashKey(key);
  const entry = keys[hash];
  if (!entry) return [404, { ok: false, error: 'Clé invalide.' }];
  if (entry.revoked) return [403, { ok: false, error: 'Cette clé a été révoquée.' }];
  const deviceHash = hashKey(`device:${deviceId}`);
  if (entry.activatedAt && entry.device !== deviceHash) return [403, { ok: false, error: 'Cette clé est déjà utilisée sur un autre appareil.' }];
  if (!entry.activatedAt) {
    Object.assign(entry, { activatedAt: now, device: deviceHash });
    await s.set('keys', keys);
  }
  const expiresAt = entry.activatedAt + days * DAY;
  if (now >= expiresAt) return [403, { ok: false, error: 'Cette clé a expiré.' }];
  return [200, { ok: true, id: hash.slice(0, 8), expiresAt }];
}
