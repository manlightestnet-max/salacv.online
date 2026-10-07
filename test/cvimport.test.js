// Contrat de l'import : réponse de l'IA tolérée puis normalisée ; chaque valeur prouvée par le texte du PDF ;
// dates, formats et doublons signalés. Rien d'incertain ne passe pour sûr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, toCandidate, fields } from '../server/cvimport/contract.js';
import { review, unmatched, semanticIssues } from '../server/cvimport/checks.js';
import { CVS } from './fixtures/import-cvs.js';

const NOW = new Date('2026-10-07');

test('JSON de l’IA : bloc ```json```, texte autour, ou rien d’exploitable', () => {
  assert.deepEqual(parseJson('Voici :\n```json\n{"profile":{"name":"A"}}\n```'), { profile: { name: 'A' } });
  assert.deepEqual(parseJson('ok {"skills":["Excel"]} fin'), { skills: ['Excel'] });
  assert.equal(parseJson('pas de json'), null);
  assert.equal(parseJson('[1,2]'), null);
});

test('candidat : formes tolérées, normalisé, chemins incertains filtrés', () => {
  const { state, aiUncertain } = toCandidate({
    profile: { name: '  Awa  ', phones: '06 111 22 33' },
    experiences: [{ title: 'Caissière', details: 'Accueil\nCaisse' }, 'n’importe quoi'],
    skills: 'Excel; Word',
    languages: [{ name: 'Français', level: 3 }],
    uncertain: ['profile.name', 'profile.motdepasse', 'experiences.0.details.1'],
  });
  assert.equal(state.profile.name, 'Awa');
  assert.deepEqual(state.profile.phones, ['06 111 22 33']);
  assert.equal(state.experiences[0].details, 'Accueil\nCaisse');
  assert.deepEqual(state.skills, ['Excel', 'Word']);
  assert.equal(state.languages[0].level, '3');
  assert.deepEqual(aiUncertain, ['profile.name', 'experiences.0.details.1']);
  assert.ok(fields(state).some(([p]) => p === 'experiences.0.details.1'));
});

for (const cv of CVS) {
  test(`import de test : ${cv.name}`, () => {
    const { state, aiUncertain } = toCandidate(cv.ai);
    const r = review(state, { sourceText: cv.text, aiUncertain, now: NOW });
    assert.equal(r.proven, true);
    assert.deepEqual(r.verify, cv.expectVerify);
  });
}

test('téléphone : retrouvé sans l’indicatif ni les espaces', () => {
  const { state } = toCandidate({ profile: { name: 'Awa Mboungou', phones: ['+242066123456'] } });
  assert.equal(unmatched(state, 'Awa Mboungou — tél. 06 612 34 56 — Brazzaville, quartier Bacongo').size, 0);
});

test('photo ou scan (pas de texte) : rien n’est prouvé, seuls les doutes de l’IA et les formats comptent', () => {
  const { state, aiUncertain } = toCandidate({ profile: { name: 'Awa', email: 'awa@', phones: ['12'] }, uncertain: ['profile.name'] });
  const r = review(state, { sourceText: '', aiUncertain, now: NOW });
  assert.equal(r.proven, false);
  assert.deepEqual(r.verify, ['profile.email', 'profile.name', 'profile.phones.0']);
});

test('sémantique : nom manquant, poste sans intitulé', () => {
  const { state } = toCandidate({ experiences: [{ org: 'MTN Congo', period: '2024' }] });
  const kinds = semanticIssues(state, { now: NOW }).map((i) => `${i.path}:${i.kind}`);
  assert.deepEqual(kinds, ['profile.name:missing', 'experiences.0.title:missing']);
});
