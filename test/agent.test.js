// Agent : modèle simulé, aucun réseau, aucune vraie clé.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handle } from '../server/agent/run.js';
import { announcesFutureWork } from '../server/agent/loop.js';
import { normalize, LIMITS } from '../server/agent/state.js';
import { callLLM } from '../server/agent/llm/client.js';
import { allKeys, resetExhausted } from '../server/agent/llm/providers.js';
import { issue, verify, TTL } from '../server/agent/auth.js';
import * as web from '../server/agent/web.js';
import { redact } from '../server/agent/secrets.js';
import { createApp } from '../server/index.js';

const ENV = { OLLAMA_API_KEY: 'cle-de-test-abcdef123456' };

const call = (tool, args = {}) => ({ id: `c-${tool}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });

// Modèle simulé : renvoie les tours prévus dans l'ordre et garde les messages reçus.
function scripted(...turns) {
  const seen = [];
  const model = async (messages) => {
    seen.push(structuredClone(messages));
    return { choices: [{ message: { role: 'assistant', content: null, tool_calls: turns[seen.length - 1] } }] };
  };
  model.seen = seen;
  return model;
}

beforeEach(() => {
  web.loginLimiter.hits.clear();
  web.agentLimiter.hits.clear();
  resetExhausted();
});

test('remplit le CV depuis un message en vrac', async () => {
  const model = scripted(
    [
      call('set_identity', { name: 'Rais Wasongolua', title: 'Juriste', phones: ['+243 82 22 14 440'], email: 'rais@gmail.com' }),
      call('add_entry', { section: 'education', period: '2016 — 2017', title: 'Licence en droit privé et judiciaire', org: 'Université Protestante au Congo' }),
      call('add_entry', { section: 'experiences', period: '2017', title: 'Secrétaire juridique', org: 'Cabinet Kahisha', details: ['Gestion des courriers', 'Suivi des dossiers'] }),
      call('edit_list', { section: 'skills', items: ['Rédaction juridique', 'Microsoft Office'] }),
      call('set_languages', { languages: [{ name: 'Français', level: 'Courant' }, { name: 'Lingala', level: 'Natif' }] }),
    ],
    [call('final_answer', { text: "J'ai rempli ton CV. Ajoute un profil professionnel ?" })],
  );
  const out = await handle({ state: { education: [{}] }, message: 'je suis rais wasongolua juriste …' }, { callModel: model, env: ENV });
  assert.equal(out.ok, true);
  const s = out.state;
  assert.equal(s.profile.name, 'Rais Wasongolua');
  assert.deepEqual(s.profile.phones, ['+243 82 22 14 440']);
  assert.equal(s.education.length, 1, 'le bloc vide du formulaire est remplacé, pas doublé');
  assert.equal(s.education[0].org, 'Université Protestante au Congo');
  assert.equal(s.experiences[0].details, 'Gestion des courriers\nSuivi des dossiers');
  assert.deepEqual(s.skills, ['Rédaction juridique', 'Microsoft Office']);
  assert.deepEqual(s.languages.map((l) => l.name), ['Français', 'Lingala']);
  assert.ok(out.changes.includes('identité'));
});

test('une modification précise garde le reste ; le modèle voit les index', async () => {
  const start = { profile: { name: 'A' }, experiences: [{ period: '2025', title: 'Stagiaire', org: 'Vodacom', details: 'Câblage' }], skills: ['Excel'] };
  const model = scripted([call('update_entry', { section: 'experiences', index: 0, details: ['Installé et câblé des baies réseau'] })], [call('final_answer', { text: "C'est reformulé." })]);
  const out = await handle({ state: start, message: 'reformule mon stage' }, { callModel: model, env: ENV });
  const exp = out.state.experiences[0];
  assert.deepEqual([exp.title, exp.org, exp.details], ['Stagiaire', 'Vodacom', 'Installé et câblé des baies réseau']);
  assert.deepEqual(out.state.skills, ['Excel']);
  assert.match(model.seen[0].at(-1).content, /"index": 0/);
});

test('final_answer qui promet est refusé une fois ; outils du même tour exécutés', async () => {
  const model = scripted(
    [call('final_answer', { text: 'Je vais remplir ton CV, un instant.' })],
    [call('set_summary', { text: "Juriste formé à l'UPC." }), call('final_answer', { text: 'Profil ajouté.' })],
  );
  const out = await handle({ state: {}, message: 'fais mon profil' }, { callModel: model, env: ENV });
  assert.equal(out.reply, 'Profil ajouté.');
  assert.equal(out.state.profile.summary, "Juriste formé à l'UPC.");
  assert.ok(announcesFutureWork('je vais ajouter ça'));
  assert.ok(!announcesFutureWork("J'ai ajouté Excel."));
});

test("erreurs d'outil renvoyées au modèle sans planter", async () => {
  const model = scripted([call('update_entry', { section: 'education', index: 7, title: 'X' }), call('outil_invente')], [call('final_answer', { text: 'ok' })]);
  const out = await handle({ state: {}, message: 'x' }, { callModel: model, env: ENV });
  const results = model.seen[1].filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
  assert.match(results[0].error, /index invalide/);
  assert.match(results[1].error, /inconnu/);
  assert.equal(out.ok, true);
});

test('données bornées', () => {
  const s = normalize({ profile: { name: 'x'.repeat(500), phones: ['1', '2', '3', '4', '1'] }, skills: 'a\nA\nb', education: 'pas une liste' });
  assert.equal(s.profile.name.length, LIMITS.name);
  assert.deepEqual(s.profile.phones, ['1', '2', '3']);
  assert.deepEqual(s.skills, ['a', 'b']);
  assert.deepEqual(s.education, []);
});

test('message vide → 400 ; aucune clé → 503 propre', async () => {
  assert.equal((await handle({ message: '  ' }, { callModel: scripted(), env: ENV })).status, 400);
  const out = await handle({ message: 'salut' }, { env: {} });
  assert.deepEqual([out.ok, out.status], [false, 503]);
});

test('rotation : clé en 429 marquée épuisée, clé suivante utilisée ; clé jamais dans les erreurs', async () => {
  const env = { OLLAMA_API_KEYS: 'cle-epuisee-000000,cle-valide-111111' };
  const used = [];
  const fetchImpl = async (url, init) => {
    used.push(init.headers.Authorization);
    if (init.headers.Authorization.endsWith('000000')) return new Response('{"error":"rate limit"}', { status: 429 });
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  };
  await callLLM([], [], { env, fetchImpl });
  await callLLM([], [], { env, fetchImpl });
  assert.deepEqual(used, ['Bearer cle-epuisee-000000', 'Bearer cle-valide-111111', 'Bearer cle-valide-111111']);
  assert.equal(redact('erreur cle-valide-111111', allKeys(env)), 'erreur ***');
});

test('connexion fictive : jeton signé, refus si absent, modifié ou expiré', async () => {
  const [status, body] = web.login({ username: 'grace.mbuyi', password: 'secret123' }, '1.2.3.4', ENV);
  assert.equal(status, 200);
  assert.ok(!body.token.includes(ENV.OLLAMA_API_KEY));
  assert.equal(verify(body.token, ENV), 'grace.mbuyi');

  const forged = `${Buffer.from('{"u":"admin","exp":9999999999}').toString('base64url')}.${body.token.split('.')[1]}`;
  for (const bad of ['', 'abc', forged, `${body.token}x`]) {
    const [code] = await web.agent({ message: 'x' }, bad, { env: ENV });
    assert.equal(code, 401, bad);
  }
  assert.equal(verify(issue('grace', ENV), ENV, Date.now() + (TTL + 1) * 1000), null);
  assert.equal(web.login({ username: 'a b', password: 'secret123' }, 'ip', ENV)[0], 400);
  assert.equal(web.login({ username: 'grace', password: '123' }, 'ip', ENV)[0], 400);
  assert.equal(web.login({ username: 'grace', password: 'secret123' }, 'ip', {})[0], 503);
  const demo = { ...ENV, SALACV_DEMO_PASSWORD: 'testeurs-2026' };
  assert.equal(web.login({ username: 'grace', password: 'autre-mdp' }, 'ip', demo)[0], 400);
  assert.equal(web.login({ username: 'grace', password: 'testeurs-2026' }, 'ip', demo)[0], 200);
});

test('limite de débit par utilisateur', async () => {
  const token = issue('grace', ENV);
  const model = () => scripted([call('final_answer', { text: 'ok' })]);
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await web.agent({ message: 'x' }, token, { env: ENV, callModel: model() }))[0]);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429]);
});

test('serveur Node (VPS) : mêmes routes que Vercel, site servi par le même process', async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/`);
    assert.ok([200, 404].includes(page.status) || page.ok);
    const bad = await fetch(`${base}/api/agent`, { method: 'POST', body: '{"message":"x"}' });
    assert.equal(bad.status, 401);
    const notJson = await fetch(`${base}/api/login`, { method: 'POST', body: 'pas du json' });
    assert.equal(notJson.status, 400);
    const big = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ username: 'x'.repeat(70000) }) });
    assert.equal(big.status, 413);
    assert.equal((await fetch(`${base}/api/inconnu`, { method: 'POST', body: '{}' })).status, 404);
  } finally {
    server.close();
  }
});
