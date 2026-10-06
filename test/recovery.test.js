// Phrase de récupération : la clé maîtresse revient avec la bonne phrase, jamais avec une autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb } from '../server/db/index.js';
import { memoryStore, store } from '../server/store.js';
import { RecoveryError, recoverMaster, recoveryStatus, saveRecovery } from '../server/recovery.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64'), SALACV_SESSION_SECRET: 'secret-de-session-de-test' };
const PHRASE = 'mon fleuve Congo coule vers la mer';

test('sans sauvegarde : statut « non définie », récupération impossible', async () => {
  assert.deepEqual(await recoveryStatus(ENV), { saved: false });
  await assert.rejects(recoverMaster(PHRASE), RecoveryError);
});

test('phrase trop courte refusée', async () => {
  await assert.rejects(saveRecovery('court', ENV), /12 caractères/);
});

test('la bonne phrase rend la clé maîtresse et le secret de session ; la base ne les contient pas en clair', async () => {
  const status = await saveRecovery(PHRASE, ENV);
  assert.equal(status.saved, true);
  assert.equal(status.current, true);
  const raw = JSON.stringify(await store().get('masterRecovery'));
  assert.ok(!raw.includes(ENV.SALACV_MASTER_KEY) && !raw.includes(ENV.SALACV_SESSION_SECRET) && !raw.includes(PHRASE));

  const keys = await recoverMaster(PHRASE);
  assert.equal(keys.masterKey, ENV.SALACV_MASTER_KEY);
  assert.equal(keys.sessionSecret, ENV.SALACV_SESSION_SECRET);
  await assert.rejects(recoverMaster('une autre phrase assez longue'), /Phrase incorrecte/);
});

test('clé maîtresse changée depuis : la sauvegarde est signalée « ancienne » et rend toujours l’ancienne clé', async () => {
  const other = { SALACV_MASTER_KEY: randomBytes(32).toString('base64') };
  assert.equal((await recoveryStatus(other)).current, false);
  assert.equal((await recoverMaster(PHRASE)).masterKey, ENV.SALACV_MASTER_KEY);
});
