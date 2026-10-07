// Réglages de l'agent (admin) : étapes, historique, plafond de tokens par demande, skills par demande ; coûts en FCFA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb, query } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';
import { setSetting } from '../server/settings.js';
import { agentTuning, aiCosts } from '../server/aitune.js';
import { BUDGET_STOP, runLoop } from '../server/agent/loop.js';
import { build } from '../server/agent/prompt.js';
import { normalize } from '../server/agent/state.js';
import { handle } from '../server/agent/run.js';
import loadSkill from '../server/agent/tools/load-skill.js';
import { logUsage } from '../server/keys/pool.js';

await memoryDb();
memoryStore();

const call = (tool, args = {}) => ({ id: `c-${tool}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });

test('réglages par défaut, bornés', async () => {
  assert.deepEqual(await agentTuning(), { maxSteps: 6, historySent: 6, maxTokensPerRequest: 60000, maxSkills: 2 });
  await setSetting('ai.maxSteps', '40');
  assert.equal((await agentTuning()).maxSteps, 12);
  await setSetting('ai.maxSteps', '6');
});

test('plafond de tokens : l’agent s’arrête proprement après l’étape qui le dépasse', async () => {
  let n = 0;
  const model = async () => (n++, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [call('set_identity', { title: `Juriste ${n}` })] } }] });
  const spent = { tokens: 0 };
  const tools = new Map([['set_identity', { run: () => ((spent.tokens += 50_000), { ok: true }) }]]);
  const reply = await runLoop({ flags: {} }, [], [], tools, model, 8, () => spent.tokens >= 60_000);
  assert.equal(reply, BUDGET_STOP);
  assert.equal(n, 2);
});

test('historique : seulement les derniers messages réglés', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }));
  assert.equal(build(normalize({}), 'x', history, { historySent: 2 }).length, 1 + 2 + 1);
  assert.equal(build(normalize({}), 'x', history, { historySent: 0 }).length, 2);
});

test('skills : pas plus que le nombre réglé par demande', async () => {
  const run = { maxSkills: 1, countSkills: false };
  assert.ok((await loadSkill.run(run, { slug: 'cv-congolais' })).content);
  assert.ok((await loadSkill.run(run, { slug: 'cv-congolais' })).content); // la même : pas recomptée
  assert.match((await loadSkill.run({ maxSkills: 1, skills: ['autre'], countSkills: false }, { slug: 'cv-congolais' })).error, /Limite/);
});

test('étapes : le réglage de l’admin limite la boucle', async () => {
  await setSetting('ai.maxSteps', '2');
  let n = 0;
  const callModel = async () => (n++, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [call('set_identity', { title: 'X' })] } }] });
  await handle({ state: {}, message: 'fais tout' }, { callModel, env: {} });
  assert.equal(n, 2);
  await setSetting('ai.maxSteps', '6');
});

test('coûts : tokens par fournisseur et par usage, en FCFA selon les prix saisis', async () => {
  await logUsage('ana', null, 'agent', true, 400_000, 'ollama');
  await logUsage('ana', null, 'import', true, 100_000, 'gemini');
  await setSetting('ai.price.ollama', '1000');
  await setSetting('ai.price.gemini', '2000');
  await setSetting('ai.alertDailyFcfa', '500');
  const c = await aiCosts();
  assert.equal(c.tokensToday, 500_000);
  assert.equal(c.costToday, 400 + 200);
  assert.equal(c.alerting, true);
  assert.equal(c.lines.find((l) => l.kind === 'import').provider, 'gemini');
  assert.equal((await query('SELECT provider FROM ai_usage WHERE kind = $1', ['agent']))[0].provider, 'ollama');
  assert.deepEqual(c.imports, { total: 1, ok: 1, avgTokens: 100_000, costMonth: 200 });
});
