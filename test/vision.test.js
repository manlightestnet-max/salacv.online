// Image jointe à l'assistant : lue une seule fois (texte), jamais renvoyée dans la boucle ; seuls les fournisseurs qui
// lisent les images sont essayés. Aucun réseau : modèles simulés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/agent/run.js';
import { checkImage, MAX_IMAGE_CHARS } from '../server/agent/vision.js';
import { callLLM } from '../server/agent/llm/client.js';
import { resetExhausted } from '../server/agent/llm/providers.js';
import { memoryDb } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';

await memoryDb();
memoryStore();

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const call = (tool, args = {}) => ({ id: `c-${tool}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });

test('image : PNG/JPEG/WebP en données, taille plafonnée ; le reste refusé', () => {
  assert.equal(checkImage(PNG).ok, true);
  assert.equal(checkImage(undefined).image, null);
  assert.equal(checkImage('https://exemple.test/photo.png').ok, false);
  assert.equal(checkImage('data:image/svg+xml;base64,PHN2Zz4=').ok, false);
  assert.equal(checkImage(`data:image/jpeg;base64,${'A'.repeat(MAX_IMAGE_CHARS)}`).ok, false);
});

test('l’image est lue une fois ; la boucle de l’agent reçoit le texte, jamais l’image', async () => {
  const reads = [];
  const readModel = async (messages) => {
    reads.push(messages);
    return { choices: [{ message: { content: 'Nom : Grâce Mabiala\nFormation : Licence réseaux, ENSP, 2023 — 2026' } }] };
  };
  const seen = [];
  const callModel = async (messages) => {
    seen.push(JSON.stringify(messages));
    const turns = [[call('set_identity', { name: 'Grâce Mabiala' })], [call('final_answer', { text: 'J’ai rempli ton identité. Quel est ton numéro ?' })]];
    return { choices: [{ message: { role: 'assistant', content: null, tool_calls: turns[seen.length - 1] } }] };
  };
  const out = await handle({ state: {}, message: '', image: PNG }, { callModel, readModel, env: {} });
  assert.equal(out.ok, true);
  assert.equal(reads.length, 1);
  assert.equal(reads[0][0].content[1].image_url.url, PNG);
  assert.ok(seen[0].includes('Grâce Mabiala'));
  assert.ok(seen.every((m) => !m.includes('base64')));
  assert.equal(out.state.profile.name, 'Grâce Mabiala');
});

test('image illisible ou mauvais format : message clair, rien n’est envoyé à l’agent', async () => {
  let called = false;
  const callModel = async () => ((called = true), {});
  const empty = await handle({ state: {}, message: 'tiens', image: PNG }, { callModel, readModel: async () => ({ choices: [{ message: { content: '' } }] }), env: {} });
  assert.equal(empty.ok, false);
  const bad = await handle({ state: {}, message: 'tiens', image: 'data:text/html;base64,PGI+' }, { callModel, env: {} });
  assert.equal(bad.status, 400);
  assert.equal(called, false);
});

test('vision : seuls les fournisseurs qui lisent les images sont essayés', async () => {
  resetExhausted();
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
  await callLLM([{ role: 'user', content: 'x' }], [], { env: { GROQ_API_KEY: 'groq-cle-123456', GEMINI_API_KEY: 'gemini-cle-123456' }, fetchImpl, vision: true });
  assert.ok(urls[0].startsWith('https://generativelanguage.googleapis.com'));
  await assert.rejects(callLLM([{ role: 'user', content: 'x' }], [], { env: { GROQ_API_KEY: 'groq-cle-123456' }, fetchImpl, vision: true }), /images/);
});
