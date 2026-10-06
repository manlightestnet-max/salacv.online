// Clé maîtresse changée (perdue) : les secrets chiffrés avec l'ancienne ne cassent rien, ils sont signalés à ressaisir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { memoryDb } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import { getSetting, listSettings, setSetting } from '../server/settings.js';
import * as pool from '../server/keys/pool.js';

await memoryDb();
memoryStore();

const OLD = { SALACV_MASTER_KEY: randomBytes(32).toString('base64') };
const NEW = { SALACV_MASTER_KEY: randomBytes(32).toString('base64') };

test('réglage secret chiffré avec une ancienne clé : non configuré, signalé, ressaisissable', async () => {
  await setSetting('lightpay.keySandbox', 'sec_test_ancienne', OLD);
  assert.equal(await getSetting('lightpay.keySandbox', OLD), 'sec_test_ancienne');

  assert.equal(await getSetting('lightpay.keySandbox', NEW), ''); // pas d'exception : « non configuré »
  const row = (await listSettings(NEW)).find((s) => s.key === 'lightpay.keySandbox');
  assert.equal(row.unreadable, true);
  assert.equal(row.set, false);

  await setSetting('lightpay.keySandbox', 'sec_test_nouvelle', NEW);
  assert.equal(await getSetting('lightpay.keySandbox', NEW), 'sec_test_nouvelle');
  assert.equal((await listSettings(NEW)).find((s) => s.key === 'lightpay.keySandbox').unreadable, false);
});

test('clé IA chiffrée avec une ancienne clé : listée « illisible », jamais utilisée', async () => {
  const key = await pool.addKey({ provider: pool.providers()[0], secret: `sk-${randomBytes(16).toString('hex')}`, createdBy: 'admin' }, OLD);
  const listed = (await pool.listKeys({ env: NEW })).find((k) => k.id === key.id);
  assert.equal(listed.unreadable, true);
  assert.equal((await pool.listKeys({ env: OLD })).find((k) => k.id === key.id).unreadable, false);
});
