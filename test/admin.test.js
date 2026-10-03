import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../server/store.js';
import { admin, checkResources, collect, templateSettings } from '../server/admin.js';
import * as web from '../server/agent/web.js';
import { findSkill, setExtraSkills } from '../server/agent/skills/index.js';

memoryStore();
const ENV = { OLLAMA_API_KEY: 'k-test-1234567890', SALACV_ADMIN_PASSWORD: 'admin-pass-1' };

async function login() {
  const [code, body] = await admin({ action: 'login', password: 'admin-pass-1' }, '', ENV);
  assert.equal(code, 200);
  return body.token;
}

test('admin : fermée sans mot de passe, refus sans jeton ou avec un jeton étudiant', async () => {
  assert.equal((await admin({ action: 'login', password: 'x' }, '', { OLLAMA_API_KEY: 'k' }))[0], 503);
  assert.equal((await admin({ action: 'login', password: 'mauvais' }, '', ENV))[0], 401);
  assert.equal((await admin({ action: 'users' }, '', ENV))[0], 401);
  const [, student] = await web.login({ username: 'grace', password: 'secret123' }, 'ip-a', ENV);
  assert.equal((await admin({ action: 'users' }, student.token, ENV))[0], 401);
});

test('admin : bloquer un utilisateur coupe connexion et assistant, débloquer rétablit', async () => {
  const token = await login();
  const [, user] = await web.login({ username: 'patrick', password: 'secret123' }, 'ip-b', ENV);
  const [, list] = await admin({ action: 'users' }, token, ENV);
  assert.ok(list.users.some((u) => u.username === 'patrick' && u.logins === 1));
  assert.equal((await admin({ action: 'block', username: 'patrick', reason: 'abus' }, token, ENV))[0], 200);
  assert.equal((await web.login({ username: 'patrick', password: 'secret123' }, 'ip-b', ENV))[0], 403);
  assert.equal((await web.agent({ message: 'x' }, user.token, { env: ENV }))[0], 403);
  await admin({ action: 'unblock', username: 'patrick' }, token, ENV);
  assert.equal((await web.login({ username: 'patrick', password: 'secret123' }, 'ip-b', ENV))[0], 200);
});

test('admin : CV d\'essai conservés sans photo, ressources validées, skills ajoutées à l\'agent', async () => {
  const token = await login();
  await collect({ template: 'minimal', profile: { name: 'Grâce', photo: 'data:image/png;base64,AAA' }, sections: [] }, 'grace');
  const [, cvs] = await admin({ action: 'cvs' }, token, ENV);
  assert.equal(cvs.cvs[0].resume.profile.name, 'Grâce');
  assert.equal(cvs.cvs[0].resume.profile.photo, undefined);

  assert.ok(checkResources([]));
  assert.ok(checkResources({ metiers: 'x' }));
  assert.equal((await admin({ action: 'setResources', resources: { metiers: [{ profession: 'Comptable' }] } }, token, ENV))[1].counts.metiers, 1);

  assert.equal((await admin({ action: 'saveSkill', skill: { slug: 'cv-congolais', title: 't', content: 'c' } }, token, ENV))[0], 400);
  assert.equal((await admin({ action: 'saveSkill', skill: { slug: 'petrole', title: 'Pétrole', description: 'Métiers du pétrole', content: '# HSE…' } }, token, ENV))[0], 200);
  const [, skills] = await admin({ action: 'skills' }, token, ENV);
  setExtraSkills(skills.custom);
  assert.equal(findSkill('petrole').title, 'Pétrole');
});

test('modèles : disponibilité et public gérés par l’admin, lus par le studio', async () => {
  const token = await login();
  const [st, r] = await admin({ action: 'setTemplate', id: 'marine', enabled: false, audience: 'pro' }, token, ENV);
  assert.equal(st, 200);
  assert.deepEqual(r.templates.marine, { enabled: false, audience: 'pro' });
  const [, pub] = await templateSettings();
  assert.equal(pub.templates.marine.enabled, false);
});

test('DSL des modèles : téléversé, validé, lu par le studio, supprimé', async () => {
  const token = await login();
  const bad = await admin({ action: 'saveTemplateSpec', spec: { id: 'Mon Modèle', name: 'x' } }, token, ENV);
  assert.equal(bad[0], 400);
  const dup = await admin({ action: 'saveTemplateSpec', spec: { id: 'cursus', name: 'x' } }, token, ENV);
  assert.equal(dup[0], 400);
  const [st, r] = await admin({ action: 'saveTemplateSpec', spec: { id: 'kin-bleu', name: 'Kin bleu', header: 'pill', heading: 'band', colors: { band: '#DBEAFE' } } }, token, ENV);
  assert.equal(st, 200);
  assert.equal(r.specs[0].bullet, 'dot'); // valeurs par défaut remplies
  const [, pub] = await templateSettings();
  assert.equal(pub.specs[0].id, 'kin-bleu');
  const [, del] = await admin({ action: 'deleteTemplateSpec', id: 'kin-bleu' }, token, ENV);
  assert.equal(del.specs.length, 0);
});
