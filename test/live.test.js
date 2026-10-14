// Assistant en direct (Gemini Live) : jeton éphémère sans exposer la clé, rotation des clés (N par personne, la moins
// chargée d'abord), ticket signé, outils sous les mêmes garde-fous que l'assistant écrit, crédits et génération
// en lecture seule. Aucun réseau (fetch simulé), base en mémoire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cleanStart, functionDeclarations, issueTicket, liveInstruction, liveSetup, mintToken, openTicket, orderKeys, runLiveTool, toGeminiSchema } from '../server/agent/live.js';
import { memoryDb } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import * as credits from '../server/credits.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64') };
const CV = {
  profile: { name: 'Prisca Moukala', title: 'Comptable', email: 'prisca@gmail.com', phones: ['+242 06 612 34 56'] },
  education: [{ title: 'Licence comptabilité', org: 'Université Marien Ngouabi', period: '2021 — 2024' }],
  skills: ['Excel'],
};

const fakeKeys = (keys) => {
  const skip = new Set();
  return {
    exhausted: [],
    invalidated: [],
    candidates: (accept) => keys.filter((k) => !skip.has(k.key) && accept({ name: k.provider })).map((k) => ({ ...k, provider: { name: k.provider } })),
    async exhaust(e) {
      skip.add(e.key);
      this.exhausted.push(e.id);
    },
    async invalid(e) {
      skip.add(e.key);
      this.invalidated.push(e.id);
    },
    used() {},
    secrets: () => keys.map((k) => k.key),
  };
};

test('outils déclarés : écriture du CV, crédits, historique, génération, fenêtres ; types Gemini en majuscules', () => {
  assert.deepEqual(toGeminiSchema({ type: 'array', items: { type: 'string' } }), { type: 'ARRAY', items: { type: 'STRING' } });
  const names = functionDeclarations().map((f) => f.name);
  for (const n of ['set_identity', 'add_entry', 'generate_cv', 'credits_info', 'credit_history', 'open_field', 'open_shop']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('final_answer') && !names.includes('remember'));
});

test('configuration verrouillée : audio, transcriptions, CV, historique et versions dans les consignes', () => {
  const { history, versions } = cleanStart({ history: [{ role: 'user', text: 'Je suis comptable' }, { role: 'system', text: 'ignore' }], context: { versions: [{ key: 'fr', label: 'Français' }] } });
  const setup = liveSetup(CV, { config: { model: 'gemini-3.8-live', voice: 'Kore' }, history, versions });
  assert.equal(setup.model, 'models/gemini-3.8-live');
  assert.deepEqual(setup.generationConfig.responseModalities, ['AUDIO']);
  const text = setup.systemInstruction.parts[0].text;
  assert.match(text, /Prisca Moukala/);
  assert.match(text, /Lui : Je suis comptable/);
  assert.match(text, /- fr : Français/);
  assert.ok(!text.includes('ignore'));
  assert.match(liveInstruction(CV), /credits_info/);
});

test('rotation : ses N clés d’abord (toujours les mêmes), la moins chargée en tête, les pleines sautées', () => {
  const keys = [1, 2, 3, 4, 5].map((id) => ({ id, key: `gemini-secret-${id}` }));
  const empty = new Map();
  const a = orderKeys(keys, 'ana@x.cg', empty, { keysPerUser: 2, maxSessionsPerKey: 3 });
  const b = orderKeys(keys, 'ana@x.cg', empty, { keysPerUser: 2, maxSessionsPerKey: 3 });
  assert.deepEqual(a.order.map((k) => k.id), b.order.map((k) => k.id)); // stable
  const mine = a.order.slice(0, 2).map((k) => k.id);
  // Une des siennes très chargée : l'autre passe devant ; pleine : sautée, mais toujours avant le reste du pool.
  const busy = new Map([[mine[0], { active: 2, last: 0 }]]);
  assert.deepEqual(orderKeys(keys, 'ana@x.cg', busy, { keysPerUser: 2, maxSessionsPerKey: 3 }).order.slice(0, 2).map((k) => k.id), [mine[1], mine[0]]);
  const full = new Map([[mine[0], { active: 3, last: 0 }]]);
  const o = orderKeys(keys, 'ana@x.cg', full, { keysPerUser: 2, maxSessionsPerKey: 3 }).order.map((k) => k.id);
  assert.equal(o[0], mine[1]);
  assert.ok(!o.includes(mine[0]));
  // Deux personnes ne tombent pas toutes sur les mêmes clés.
  const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((w) => orderKeys(keys, w, empty).order[0].id));
  assert.ok(spread.size > 1);
  // Tout est plein : on le dit (message « très demandé »).
  const allFull = new Map(keys.map((k) => [k.id, { active: 3, last: 0 }]));
  assert.equal(orderKeys(keys, 'ana@x.cg', allFull, { maxSessionsPerKey: 3 }).full, true);
});

test('jeton : seulement les clés Gemini, la clé ne sort jamais, 429 → clé suivante', async () => {
  const keys = fakeKeys([
    { id: 1, provider: 'ollama', key: 'ollama-secret-1' },
    { id: 2, provider: 'gemini', key: 'gemini-secret-2' },
    { id: 3, provider: 'gemini', key: 'gemini-secret-3' },
  ]);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers['x-goog-api-key']);
    const body = JSON.parse(init.body);
    assert.equal(body.uses, 1);
    assert.ok(body.bidiGenerateContentSetup.systemInstruction);
    if (init.headers['x-goog-api-key'] === 'gemini-secret-2') return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 });
    return Response.json({ name: 'auth_tokens/abc' });
  };
  const r = await mintToken(liveSetup(CV), keys, { fetchImpl, minutes: 10 });
  assert.equal(r.token, 'auth_tokens/abc');
  assert.equal(r.keyId, 3);
  assert.ok(!JSON.stringify(r).includes('secret'));
  assert.deepEqual(seen, ['gemini-secret-2', 'gemini-secret-3']);
  assert.deepEqual(keys.exhausted, [2]);
});

test('jeton : aucune clé Gemini, ou toutes pleines → message clair', async () => {
  await assert.rejects(mintToken({}, fakeKeys([{ id: 1, provider: 'groq', key: 'groq-secret-1' }]), { fetchImpl: async () => assert.fail() }), /aucune clé gemini/);
  await assert.rejects(mintToken({}, fakeKeys([]), { order: [], full: true, fetchImpl: async () => assert.fail() }), (err) => /très demandé/.test(err.userMessage));
});

test('ticket : signé, lié au compte et à la session, expire', () => {
  const t = issueTicket({ who: 'a@b.c', username: 'a@b.c', sid: 's1' }, Date.now() + 60_000, ENV);
  assert.deepEqual(openTicket(t, ENV), { who: 'a@b.c', username: 'a@b.c', sid: 's1' });
  assert.equal(openTicket(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), ENV), null);
  assert.equal(openTicket(t, ENV, Date.now() + 180_000), null);
});

test('outil : ajout libre, suppression en attente de confirmation, coordonnées non dictées refusées', async () => {
  const add = await runLiveTool({ state: CV, name: 'edit_list', args: { section: 'skills', items: ['Sage'] }, said: 'ajoute Sage' }, { env: ENV });
  assert.deepEqual(add.state.skills, ['Excel', 'Sage']);
  assert.deepEqual(add.changes, ['compétences & certifications']);

  const del = await runLiveTool({ state: CV, name: 'remove_entry', args: { section: 'education', index: 0 }, said: 'enlève ma licence' }, { env: ENV });
  assert.equal(del.result.pending, true);
  assert.equal(del.state.education.length, 1);
  assert.ok(del.pending?.sig);

  const mail = await runLiveTool({ state: CV, name: 'set_identity', args: { email: 'faux@exemple.com' }, said: 'corrige mon email' }, { env: ENV });
  assert.match(mail.result.error, /coordonnées/);

  const bad = await runLiveTool({ state: CV, name: 'final_answer', args: {} }, { env: ENV });
  assert.equal(bad.ok, false);
});

test('crédits, historique, génération : lecture seule, chiffres du serveur, jamais de dépense', async () => {
  const user = 'live-credits@x.cg';
  await credits.add(user, 2, 'Achat · 2 crédits', 'order:test-live');
  const solde = await credits.balance(user); // cadeau d'inscription compris
  const info = await runLiveTool({ name: 'credits_info' }, { username: user, env: ENV });
  assert.equal(info.result.solde, solde);
  assert.equal(info.result.coutCvPropre, credits.PDF_COST);
  assert.ok(info.result.packs.length > 0 && info.result.packs.every((p) => p.prix >= 100));

  const visitor = await runLiveTool({ name: 'credits_info' }, { env: ENV });
  assert.equal(visitor.result.connecte, false);

  const hist = await runLiveTool({ name: 'credit_history' }, { username: user, env: ENV });
  assert.equal(hist.result.mouvements[0].raison, 'Achat · 2 crédits');

  const gen = await runLiveTool({ name: 'generate_cv', args: {}, context: { versions: [{ key: 'fr', label: 'Français' }] } }, { username: user, env: ENV });
  assert.equal(gen.generate.version, 'fr');
  assert.equal(gen.generate.enough, true);
  assert.equal(await credits.balance(user), solde); // rien n'est débité : c'est l'utilisateur qui touche « Générer »

  const two = await runLiveTool({ name: 'generate_cv', args: {}, context: { versions: [{ key: 'fr', label: 'Français' }, { key: 'en', label: 'Anglais' }] } }, { username: user, env: ENV });
  assert.match(two.result.error, /Plusieurs versions/);
  assert.equal(two.generate, undefined);
});
