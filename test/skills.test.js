// Skills : catalogue (titre + description) selon la fiche ; chargement à la demande ; une skill de connaissances
// seule ne permet pas de modifier le CV sans demande ; statistiques de chargement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/agent/run.js';
import { system } from '../server/agent/prompt.js';
import { setExtraSkills, findSkill } from '../server/agent/skills/index.js';
import loadSkill from '../server/agent/tools/load-skill.js';
import { memoryDb } from '../server/db/index.js';
import { memoryStore, store } from '../server/store.js';

await memoryDb();
memoryStore();

const call = (tool, args = {}) => ({ id: `c-${tool}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });
const SKILLS = [
  { slug: 'entretien', title: 'Entretien d’embauche', description: 'Préparer un entretien', content: '# Questions fréquentes…', kind: 'knowledge' },
  { slug: 'petrole', title: 'Métiers du pétrole', description: 'CV HSE, forage', content: '# Pétrole…', audience: 'account' },
  { slug: 'vieux', title: 'Ancienne', description: 'Désactivée', content: 'x', enabled: false },
];

test('catalogue : seulement titre et description, selon la fiche (activée, pour qui)', () => {
  setExtraSkills(SKILLS);
  const visitor = system({ loggedIn: false });
  const account = system({ loggedIn: true });
  assert.ok(visitor.includes('entretien : Entretien d’embauche — Préparer un entretien (connaissances)'));
  assert.ok(!visitor.includes('petrole') && account.includes('petrole'));
  assert.ok(!account.includes('vieux'));
  assert.ok(!account.includes('# Questions fréquentes')); // le contenu n'est jamais dans le catalogue
  assert.equal(findSkill('petrole', { loggedIn: false }), null);
  setExtraSkills([]);
});

test('skill de connaissances seule : répond, ne modifie rien sans demande ; avec demande : modifie', async () => {
  const model = (tools) => {
    let i = 0;
    return async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: tools[i++] } }] });
  };
  const run = (message) =>
    handle({ state: { profile: { name: 'Awa' } }, message }, { callModel: model([[call('load_skill', { slug: 'entretien' })], [call('set_identity', { title: 'Commerciale' })], [call('final_answer', { text: 'Voilà.' })]]), env: {}, skills: SKILLS, countSkills: false });
  const question = await run('comment préparer mon entretien ?');
  assert.equal(question.state.profile.title, '');
  assert.deepEqual(question.skills, ['entretien']);
  const asked = await run('ajoute commerciale comme métier');
  assert.equal(asked.state.profile.title, 'Commerciale');
});

test('statistiques : chaque chargement est compté', async () => {
  setExtraSkills(SKILLS);
  await loadSkill.run({}, { slug: 'entretien' });
  await loadSkill.run({}, { slug: 'entretien' });
  const stats = await store().get('skillStats', {});
  assert.equal(stats.entretien.loads, 2);
  setExtraSkills([]);
});
