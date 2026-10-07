// Garde-fous de l'agent : un modèle audacieux (simulé) ne peut ni supprimer, ni écraser sans demande, ni inventer des
// coordonnées ; un changement en attente ne s'applique que confirmé, signé, sur le même CV. Aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { handle } from '../server/agent/run.js';
import { explicitChange, fingerprint, impact } from '../server/agent/guard.js';
import { normalize } from '../server/agent/state.js';
import { normalizeState } from '../app/state.js';
import { memoryDb } from '../server/db/index.js';
import { memoryStore } from '../server/store.js';

await memoryDb();
memoryStore();

const ENV = { SALACV_MASTER_KEY: randomBytes(32).toString('base64') };
const call = (tool, args = {}) => ({ id: `c-${tool}`, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });
const scripted = (...turns) => {
  let i = 0;
  return async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: turns[i++] } }] });
};
const done = call('final_answer', { text: 'Voilà.' });
const CV = {
  profile: { name: 'Prisca Moukala', title: 'Comptable', email: 'prisca@gmail.com', phones: ['+242 06 612 34 56'], summary: 'Comptable rigoureuse.' },
  education: [{ title: 'Licence comptabilité', org: 'Université Marien Ngouabi', period: '2021 — 2024' }],
  experiences: [{ title: 'Stagiaire comptable', org: 'Cabinet Ngoma', period: '2024', details: 'Saisie des pièces' }],
  skills: ['Excel', 'Sage'],
  languages: [{ name: 'Français', level: 'Courant' }],
};

test('« supprime tout » : rien n’est supprimé, tout attend la confirmation', async () => {
  const model = scripted([call('remove_entry', { section: 'experiences', index: 0 }), call('edit_list', { section: 'skills', mode: 'replace', items: [] }), call('set_languages', { mode: 'replace', languages: [] })], [done]);
  const out = await handle({ state: CV, message: 'supprime tout' }, { callModel: model, env: ENV });
  assert.equal(out.state.experiences.length, 1);
  assert.deepEqual(out.state.skills, ['Excel', 'Sage']);
  assert.equal(out.state.languages.length, 1);
  assert.equal(out.pending.ops.length, 3);
  assert.match(out.pending.lines[0], /Supprimer l’expérience « Stagiaire comptable »/);
});

test('écraser sans qu’on le demande : en attente ; quand on le demande : appliqué', async () => {
  const quiet = await handle({ state: CV, message: 'ajoute Word à mes compétences' }, { callModel: scripted([call('edit_list', { section: 'skills', items: ['Word'] }), call('set_summary', { text: 'Tout autre profil.' })], [done]), env: ENV });
  assert.deepEqual(quiet.state.skills, ['Excel', 'Sage', 'Word']); // l'ajout passe
  assert.equal(quiet.state.profile.summary, 'Comptable rigoureuse.'); // l'écrasement non demandé attend
  assert.equal(quiet.pending.ops[0].tool, 'set_summary');
  const asked = await handle({ state: CV, message: 'reformule mon profil' }, { callModel: scripted([call('set_summary', { text: 'Comptable rigoureuse et organisée.' })], [done]), env: ENV });
  assert.equal(asked.state.profile.summary, 'Comptable rigoureuse et organisée.');
  assert.equal(asked.pending, undefined);
});

test('coordonnées inventées : refusées ; données par l’utilisateur : acceptées', async () => {
  const empty = { profile: { name: 'Awa' } };
  const invented = await handle({ state: empty, message: 'complète mon en-tête' }, { callModel: scripted([call('set_identity', { email: 'awa@gmail.com', phones: ['+242 06 000 00 00'] })], [done]), env: ENV });
  assert.equal(invented.state.profile.email, '');
  assert.deepEqual(invented.state.profile.phones, []);
  const given = await handle({ state: empty, message: 'mon mail awa.k@yahoo.fr et mon numéro 05 543 21 09' }, { callModel: scripted([call('set_identity', { email: 'awa.k@yahoo.fr', phones: ['+242 05 543 21 09'] })], [done]), env: ENV });
  assert.equal(given.state.profile.email, 'awa.k@yahoo.fr');
  assert.deepEqual(given.state.profile.phones, ['+242 05 543 21 09']);
});

test('confirmer : appliqué sans appel au modèle ; falsifié ou CV changé : refusé', async () => {
  const out = await handle({ state: CV, message: 'enlève mon stage' }, { callModel: scripted([call('remove_entry', { section: 'experiences', index: 0 })], [done]), env: ENV });
  const noModel = async () => assert.fail('le modèle ne doit pas être appelé');
  const ok = await handle({ state: out.state, confirm: out.pending }, { callModel: noModel, env: ENV });
  assert.equal(ok.ok, true);
  assert.equal(ok.state.experiences.length, 0);
  const forged = { ...out.pending, ops: [{ tool: 'remove_entry', args: { section: 'education', index: 0 } }] };
  assert.equal((await handle({ state: out.state, confirm: forged }, { callModel: noModel, env: ENV })).ok, false);
  const changed = { ...out.state, skills: ['Autre'] };
  assert.equal((await handle({ state: changed, confirm: out.pending }, { callModel: noModel, env: ENV })).status, 409);
  const otherUser = await handle({ state: out.state, confirm: out.pending }, { callModel: noModel, env: ENV, username: 'quelquun' });
  assert.equal(otherUser.ok, false);
});

test('empreinte : le CV renvoyé par le studio (après son propre nettoyage) garde la même empreinte', async () => {
  const out = await handle({ state: CV, message: 'enlève mon stage' }, { callModel: scripted([call('remove_entry', { section: 'experiences', index: 0 })], [done]), env: ENV });
  const studio = normalizeState({ ...out.state, template: 'minimal' });
  assert.equal(fingerprint(studio), out.pending.base);
});

test('impact et intention', () => {
  const a = normalize(CV);
  assert.deepEqual(impact(a, normalize({ ...CV, skills: ['Excel', 'Sage', 'Word'] })), { removed: false, overwritten: false });
  assert.deepEqual(impact(a, normalize({ ...CV, skills: ['Excel'] })), { removed: true, overwritten: false });
  assert.deepEqual(impact(a, normalize({ ...CV, profile: { ...CV.profile, title: 'Auditrice' } })), { removed: false, overwritten: true });
  assert.equal(explicitChange('corrige mon titre'), true);
  assert.equal(explicitChange('ajoute Word'), false);
});
