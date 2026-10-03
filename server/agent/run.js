// Une requête = une exécution : CV + message → CV modifié + réponse.
import { settings } from './config.js';
import { callLLM, LLMError } from './llm/client.js';
import { allKeys } from './llm/providers.js';
import { build } from './prompt.js';
import { runLoop } from './loop.js';
import { redact } from './secrets.js';
import { compact, normalize } from './state.js';
import { byName, specs } from './tools/index.js';
import { setExtraSkills } from './skills/index.js';
import { customSkills } from '../admin.js';

// Agent limité à une section (onglet ✦ IA d'une étape du studio) : seuls les outils de
// cette section, et ceux qui touchent une liste sont forcés sur la bonne.
export const SCOPES = {
  identite: { label: 'Identité et contacts', tools: ['set_identity'] },
  profil: { label: 'Profil professionnel', tools: ['set_summary'] },
  formation: { label: 'Formation & certifications', tools: ['add_entry', 'update_entry', 'remove_entry'], section: 'education' },
  experience: { label: 'Expérience professionnelle', tools: ['add_entry', 'update_entry', 'remove_entry'], section: 'experiences' },
  competences: { label: 'Compétences', tools: ['edit_list'], lists: ['skills'] },
  langues: { label: 'Langues et loisirs', tools: ['set_languages', 'edit_list'], lists: ['hobbies'] },
};
const ALWAYS = ['final_answer', 'load_skill'];

export function scopedTools(scope) {
  const s = SCOPES[scope];
  if (!s) return { specs: specs(), tools: byName };
  const names = new Set([...s.tools, ...ALWAYS]);
  const tools = new Map();
  for (const name of names) {
    const tool = byName.get(name);
    if (!tool) continue;
    tools.set(name, {
      ...tool,
      run(run, args = {}) {
        if (s.section && 'section' in (tool.parameters?.properties ?? {})) args = { ...args, section: s.section };
        if (s.lists && name === 'edit_list' && !s.lists.includes(args.section)) return { error: `Section hors sujet : ici seulement ${s.lists.join(', ')}.` };
        return tool.run(run, args);
      },
    });
  }
  return { specs: specs().filter((sp) => names.has(sp.name)), tools };
}

// payload = { state, message, history?, scope? }. callModel est injectable (tests sans réseau).
export async function handle(payload, { callModel, env = process.env } = {}) {
  const message = String(payload?.message ?? '').trim();
  if (!message) return { ok: false, status: 400, error: 'Message vide.' };

  const run = { state: normalize(payload.state), changes: new Set(), flags: {} };
  setExtraSkills(await customSkills()); // skills ajoutées depuis l'admin
  const scope = SCOPES[payload.scope] ? payload.scope : null;
  const { specs: toolSpecs, tools } = scopedTools(scope);
  const said = scope
    ? `[Section en cours : ${SCOPES[scope].label}. Tu ne modifies que cette section. S'il manque une information importante, pose UNE question courte au lieu d'inventer.]\n\n${message}`
    : message;
  const messages = build(run.state, said, payload.history);
  const secrets = allKeys(env);
  callModel ??= (msgs, sp) => callLLM(msgs, sp, { temperature: settings.temperature, timeoutMs: settings.llmTimeoutMs, env });

  let reply;
  try {
    reply = await runLoop(run, messages, toolSpecs, tools, callModel, settings.maxIterations);
  } catch (err) {
    console.error(`[LLM] ${redact(err.message, secrets)}`);
    if (err instanceof LLMError || err.name === 'TimeoutError') {
      return { ok: false, status: 503, error: "L'assistant est indisponible pour le moment. Réessaie dans un instant." };
    }
    return { ok: false, status: 502, error: "L'assistant a rencontré un problème. Réessaie." };
  }
  return { ok: true, reply: redact(reply, secrets), state: compact(run.state), changes: [...run.changes].sort() };
}
