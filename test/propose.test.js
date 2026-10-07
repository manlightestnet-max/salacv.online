// L'IA propose des modèles : seulement des modèles existants et disponibles (l'admin peut en retirer), 3 au plus,
// sans jamais changer le modèle elle-même. Aucun réseau : modèle simulé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/agent/run.js';
import propose from '../server/agent/tools/propose-templates.js';
import { memoryDb } from '../server/db/index.js';
import { memoryStore, store } from '../server/store.js';

await memoryDb();
memoryStore();

const call = (tool, args = {}) => ({ id: `c-${tool}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });

test('modèles proposés : existants, disponibles, sans doublon, 3 au plus', async () => {
  await store().set('templates', { marine: { enabled: false } });
  const run = {};
  const r = await propose.run(run, { templates: [{ id: 'classique', reason: 'Le format congolais attendu' }, { id: 'marine' }, { id: 'inconnu' }, { id: 'classique' }, { id: 'minimal' }, { id: 'sobre' }, { id: 'epure' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(run.templates.map((t) => t.id), ['classique', 'minimal', 'sobre']);
  assert.equal(run.templates[0].name, 'Classique');
  assert.equal((await propose.run({}, { templates: [{ id: 'marine' }] })).error !== undefined, true);
  await store().set('templates', {});
});

test('dans une réponse : les cartes partent au studio, le modèle du CV ne change pas', async () => {
  let n = 0;
  const callModel = async () => ({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: n++ === 0 ? [call('propose_templates', { templates: [{ id: 'cursus' }, { id: 'vitae' }] })] : [call('final_answer', { text: 'Touche le modèle qui te plaît.' })] } }],
  });
  const out = await handle({ state: { profile: { name: 'Awa' } }, message: 'quel modèle ?', context: { template: { id: 'minimal', chosen: false } } }, { callModel, env: {} });
  assert.deepEqual(out.templates.map((t) => t.id), ['cursus', 'vitae']);
  assert.equal(out.state.template, undefined);
});
