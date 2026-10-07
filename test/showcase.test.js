// Landing : les CV des démonstrations se mettent en page dans chaque modèle ; coordonnées de l'admin validées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { layoutResume, loadFontSet } from '../src/index.js';
import { TEMPLATES } from '../app/state.js';
import { EN, PT, fillScript, translated } from '../app/landing-demo-data.js';
import { checkContact } from '../server/contact.js';

const example = JSON.parse(await readFile(new URL('../examples/etudiant.json', import.meta.url), 'utf8'));
const fonts = await loadFontSet((f) => readFile(new URL(`../fonts/${f}`, import.meta.url)));

test('démos : chaque étape et chaque langue se mettent en page, dans tous les modèles', () => {
  const resumes = [...fillScript(example).map((s) => s.resume), translated(example, 'en', EN), translated(example, 'pt', PT)];
  for (const t of TEMPLATES) for (const r of resumes) assert.equal(layoutResume({ ...r, template: t.id }, fonts).ok, true, `${t.id} ${r.lang ?? 'fr'}`);
  assert.equal(translated(example, 'en', EN).sections[1].items[0].org, 'MTN Congo'); // les noms propres ne changent pas
});

test('contact : e-mail, WhatsApp +242, adresses https ; vide permis', () => {
  assert.deepEqual(checkContact('contact.email', ' Contact@Salacv.online '), { ok: true, value: 'contact@salacv.online' });
  assert.equal(checkContact('contact.email', 'pas-un-email').ok, false);
  assert.deepEqual(checkContact('contact.whatsapp', '+242 06 612 34 56'), { ok: true, value: '+242066123456' });
  assert.deepEqual(checkContact('contact.whatsapp', '00242 05 543 21 09'), { ok: true, value: '+242055432109' });
  assert.equal(checkContact('contact.whatsapp', '+243 81 234 5678').ok, false);
  assert.equal(checkContact('contact.whatsapp', '06 612 34 56').ok, false);
  assert.equal(checkContact('contact.facebook', 'https://www.facebook.com/salacv').ok, true);
  assert.equal(checkContact('contact.facebook', 'http://facebook.com/salacv').ok, false);
  assert.equal(checkContact('contact.facebook', 'https://evil.example/facebook.com/x').ok, false);
  assert.equal(checkContact('contact.tiktok', 'https://www.tiktok.com/@salacv').ok, true);
  assert.equal(checkContact('contact.tiktok', 'https://www.tiktok.com/salacv').ok, false);
  assert.deepEqual(checkContact('contact.tiktok', '  '), { ok: true, value: '' });
});
