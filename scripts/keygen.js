#!/usr/bin/env node
// Générateur de clés KEYGEN (à lancer par toi, en local ; il ne fait aucune requête réseau
// sauf vers le stockage du serveur pour les clés « en ligne », si Upstash est configuré).
//
//   node scripts/keygen.js init --out <fichier>          crée la paire Ed25519 ; la clé PRIVÉE va dans <fichier>
//                                                          (hors du dépôt, à garder secret) ; affiche la clé PUBLIQUE
//   node scripts/keygen.js offline [--count N]            clés hors ligne (signées) — clé privée : --private <fichier>
//                                                          ou KEYGEN_PRIVATE_KEY_FILE
//   node scripts/keygen.js online  [--count N] [--note …] clés en ligne (opaques, enregistrées côté serveur)
//   node scripts/keygen.js revoke <clé en ligne>          révoque une clé en ligne
//   node scripts/keygen.js list                           état des clés en ligne (sans jamais les afficher)
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateOfflineKey } from '../src/license/offline.js';
import { createOnlineKeys, revokeOnlineKey } from '../server/accounts/keys.js';
import { store } from '../server/store.js';

const args = process.argv.slice(2);
const command = args.shift();
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const count = Math.max(1, Math.min(500, Number(flag('count', 1)) || 1));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (command === 'init') {
  const out = flag('out');
  if (!out) fail('Indique où ranger la clé privée : node scripts/keygen.js init --out <fichier>');
  const target = path.resolve(out);
  if (existsSync(target)) fail(`Refus d'écraser ${target}.`);
  if (!path.relative(process.cwd(), target).startsWith('..')) fail('La clé privée doit être rangée HORS du dépôt.');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Clé privée écrite dans : ${target}  (garde-la secrète, sauvegarde-la)`);
  console.log('\nClé publique à coller dans src/license/public-key.js :\n');
  console.log(`export const PUBLIC_KEY = '${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}';`);
} else if (command === 'offline') {
  const file = flag('private', process.env.KEYGEN_PRIVATE_KEY_FILE);
  if (!file) fail('Indique la clé privée : --private <fichier> ou KEYGEN_PRIVATE_KEY_FILE.');
  const pem = readFileSync(file, 'utf8');
  for (let i = 0; i < count; i += 1) console.log(generateOfflineKey(pem));
} else if (command === 'online') {
  for (const key of await createOnlineKeys(count, flag('note', ''))) console.log(key);
} else if (command === 'revoke') {
  const key = args[0];
  if (!key) fail('Indique la clé : node scripts/keygen.js revoke <clé>');
  console.log((await revokeOnlineKey(key)) ? 'Clé révoquée.' : 'Clé introuvable.');
} else if (command === 'list') {
  const keys = await store().get('keys', {});
  const rows = Object.entries(keys).map(([hash, k]) => ({
    id: hash.slice(0, 8),
    état: k.revoked ? 'révoquée' : k.activatedAt ? 'activée' : 'jamais utilisée',
    créée: new Date(k.createdAt).toISOString().slice(0, 10),
    activée: k.activatedAt ? new Date(k.activatedAt).toISOString().slice(0, 10) : '',
    note: k.note ?? '',
  }));
  console.table(rows);
} else {
  fail('Commandes : init · offline · online · revoke · list  (voir l’en-tête de scripts/keygen.js)');
}
