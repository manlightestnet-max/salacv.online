import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translate, parseTranslations } from '../server/agent/translate.js';
import { csvToLabels } from '../scripts/i18n.js';
import { memoryStore } from '../server/store.js';

memoryStore();
import { label } from '../src/i18n/index.js';

const state = {
  profile: { name: 'Grâce Mbuyi', title: 'Technicienne réseaux', email: 'g@x.cd', phones: ['+243 81'], address: 'Kinshasa', summary: 'Rigoureuse.' },
  education: [{ period: '2023 — 2026', title: 'Licence en réseaux', org: 'ISTA', details: 'Routage\nFibre' }],
  experiences: [],
  skills: ['Câblage'],
  languages: [{ name: 'Français', level: 'Courant' }],
  hobbies: ['Lecture'],
};

test('traduction : chaque texte revient à sa place, nom et contacts jamais envoyés', async () => {
  let sent;
  const callModel = async (msgs) => {
    sent = JSON.parse(msgs[1].content);
    return { choices: [{ message: { content: JSON.stringify({ t: sent.map((s) => `EN:${s}`) }) } }] };
  };
  const r = await translate({ state, to: 'en' }, { callModel });
  assert.equal(r.ok, true);
  assert.equal(r.state.lang, 'en');
  assert.ok(!sent.some((s) => /Grâce|g@x|\+243|Kinshasa/.test(s)));
  assert.equal(r.state.profile.name, 'Grâce Mbuyi');
  assert.equal(r.state.profile.title, 'EN:Technicienne réseaux');
  assert.equal(r.state.education[0].details, 'EN:Routage\nFibre');
  assert.deepEqual(r.state.skills, ['EN:Câblage']);
  assert.equal(r.state.languages[0].level, 'Courant');
});

test('traduction : réponse mal formée refusée, langue inconnue refusée', async () => {
  const bad = async () => ({ choices: [{ message: { content: '{"t": ["un seul"]}' } }] });
  assert.equal((await translate({ state, to: 'en' }, { callModel: bad })).ok, false);
  assert.equal((await translate({ state, to: 'xx' }, { callModel: bad })).status, 400);
  assert.equal(parseTranslations('blabla {"t":["a","b"]} fin', 2).length, 2);
});

test('tableau i18n : CSV façon Excel → libellés, repli sur le français', () => {
  const labels = csvToLabels(readFileSync(new URL('../i18n/cv.csv', import.meta.url), 'utf8'));
  assert.equal(labels.en['section.experiences'], 'Professional experience');
  assert.equal(label('en', 'level.Courant'), 'Fluent');
  assert.equal(label('zz', 'label.profile'), 'Profil');
  assert.deepEqual(csvToLabels('cle;fr;en\r\n"a;b";"x ""y""";\n'), { fr: { 'a;b': 'x "y"' }, en: {} });
});
