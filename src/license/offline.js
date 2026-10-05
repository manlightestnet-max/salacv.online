// Clés KEYGEN hors ligne : autonomes, signées (Ed25519), vérifiables sans Internet.
//
// Une clé ne contient ni date de fin ni nom : seulement un identifiant et sa date d'émission, signés.
// La durée de vie est une constante de l'app (config.js), comptée à partir de l'activation.
//
//   SCVO-XXXXXX-XXXXXX-…   (base32 de : version 1 octet · émission 4 octets · identifiant 8 octets · signature 64 octets)
import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

export const OFFLINE_PREFIX = 'SCVO';
const VERSION = 1;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const group = (text, n) => text.match(new RegExp(`.{1,${n}}`, 'g')).join('-');
const signedPart = (payload) => Buffer.concat([Buffer.from(`${OFFLINE_PREFIX}${VERSION}`), payload]);

// privateKeyPem : clé privée Ed25519 (PEM). Retourne la clé à donner au client.
export function generateOfflineKey(privateKeyPem, { now = Date.now(), id = randomBytes(8) } = {}) {
  const payload = Buffer.alloc(13);
  payload.writeUInt8(VERSION, 0);
  payload.writeUInt32BE(Math.floor(now / 1000), 1);
  id.copy(payload, 5);
  const signature = sign(null, signedPart(payload), createPrivateKey(privateKeyPem));
  return `${OFFLINE_PREFIX}-${group(toBase32(Buffer.concat([payload, signature])), 6)}`;
}

// publicKeyB64 : SPKI DER en base64 (src/license/public-key.js).
// → { ok: true, id, issuedAt } ou { ok: false, error }
export function parseOfflineKey(key, publicKeyB64) {
  if (!publicKeyB64) return { ok: false, error: 'La clé publique de l’app n’est pas configurée.' };
  const text = String(key ?? '').toUpperCase().replace(/[\s-]+/g, '');
  if (!text.startsWith(OFFLINE_PREFIX)) return { ok: false, error: 'Ce n’est pas une clé hors ligne.' };
  const raw = fromBase32(text.slice(OFFLINE_PREFIX.length));
  if (!raw || raw.length < 77) return { ok: false, error: 'Clé invalide.' };
  const payload = raw.subarray(0, 13);
  const signature = raw.subarray(13, 77);
  if (payload.readUInt8(0) !== VERSION) return { ok: false, error: 'Version de clé non prise en charge.' };
  let valid = false;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    valid = verify(null, signedPart(payload), publicKey, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: 'Clé invalide.' };
  return { ok: true, id: payload.subarray(5, 13).toString('hex'), issuedAt: payload.readUInt32BE(1) * 1000 };
}
