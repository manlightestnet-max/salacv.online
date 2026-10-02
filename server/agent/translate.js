// Traduction d'un CV : une requête = un appel au modèle. On envoie seulement les textes
// saisis (numérotés), le modèle renvoie la même liste traduite ; on remet chaque texte à
// sa place. Noms, emails, téléphones, adresse et photo ne partent jamais au modèle ; les
// titres de sections et les niveaux viennent du tableau i18n/cv.csv, pas du modèle.
import { settings } from './config.js';
import { callLLM, LLMError } from './llm/client.js';
import { allKeys } from './llm/providers.js';
import { redact } from './secrets.js';
import { compact, normalize } from './state.js';

export const TARGETS = { fr: 'French', en: 'English', ln: 'Lingala', sw: 'Swahili', pt: 'Portuguese' };
const MAX_STRINGS = 200;

// Textes à traduire : [{ get, set }] dans l'ordre du CV.
function fields(state) {
  const out = [];
  const add = (obj, key) => obj[key] && out.push({ text: obj[key], set: (v) => (obj[key] = v) });
  add(state.profile, 'title');
  add(state.profile, 'summary');
  for (const list of ['education', 'experiences']) {
    for (const it of state[list]) for (const k of ['title', 'org', 'period', 'details']) add(it, k);
  }
  state.skills.forEach((_, i) => add(state.skills, i));
  state.hobbies.forEach((_, i) => add(state.hobbies, i));
  for (const l of state.languages) add(l, 'name');
  return out.slice(0, MAX_STRINGS);
}

function prompt(texts, to) {
  return [
    {
      role: 'system',
      content:
        `You translate the content of a student's CV into ${TARGETS[to]}. ` +
        'You receive a JSON array of strings and answer ONLY with a JSON object {"t": [...]} holding the translations, same length, same order. ' +
        'Rules: professional CV tone; keep proper nouns (schools, companies, cities, brands, product names), acronyms, emails and numbers unchanged; ' +
        'translate month names and words like "aujourd\'hui" in date ranges, keep years and the dash; keep line breaks (\\n); never add, merge or invent content.',
    },
    { role: 'user', content: JSON.stringify(texts) },
  ];
}

export function parseTranslations(content, count) {
  const json = String(content ?? '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const t = JSON.parse(json).t;
    return Array.isArray(t) && t.length === count && t.every((x) => typeof x === 'string') ? t : null;
  } catch {
    return null;
  }
}

// payload = { state, to }. callModel injectable pour les tests.
export async function translate(payload, { callModel, env = process.env } = {}) {
  const to = String(payload?.to ?? '');
  if (!TARGETS[to]) return { ok: false, status: 400, error: 'Langue non prise en charge.' };
  const state = normalize(payload?.state);
  const list = fields(state);
  if (!list.length) return { ok: true, state: { ...compact(state), lang: to } };

  callModel ??= (msgs) => callLLM(msgs, [], { temperature: 0.2, timeoutMs: settings.llmTimeoutMs * 2, env });
  let out = null;
  try {
    // Une seconde chance si la réponse est mal formée.
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      const res = await callModel(prompt(list.map((f) => f.text), to));
      out = parseTranslations(res?.choices?.[0]?.message?.content, list.length);
    }
  } catch (err) {
    console.error(`[traduction] ${redact(err.message, allKeys(env))}`);
    if (err instanceof LLMError || err.name === 'TimeoutError') return { ok: false, status: 503, error: 'La traduction est indisponible pour le moment. Réessaie dans un instant.' };
    return { ok: false, status: 502, error: 'La traduction a échoué. Réessaie.' };
  }
  if (!out) return { ok: false, status: 502, error: 'La traduction a échoué. Réessaie.' };
  list.forEach((f, i) => f.set(out[i].trim() || f.text));
  return { ok: true, state: { ...compact(normalize(state)), lang: to } };
}
