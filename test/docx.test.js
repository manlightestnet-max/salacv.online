import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDocx } from '../src/render/docx.js';

test('export Word : un .docx valide (zip) depuis le DSL', async () => {
  const resume = JSON.parse(readFileSync(new URL('../examples/etudiant.json', import.meta.url)));
  const buf = await renderDocx(resume);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(buf.length > 5000);
});
