// Une requête = une exécution : CV + message → CV modifié + réponse.
import { settings } from './config.js';
import { callLLM, LLMError } from './llm/client.js';
import { allKeys } from './llm/providers.js';
import { build } from './prompt.js';
import { runLoop } from './loop.js';
import { checkImage, readImage, withImageText } from './vision.js';
import { agentTuning } from '../aitune.js';
import { openPending, sealPending } from './guard.js';
import { redact } from './secrets.js';
import { compact, normalize } from './state.js';
import { byName, specs } from './tools/index.js';
import { setExtraSkills } from './skills/index.js';
import { customSkills } from '../admin.js';
import { listMemory } from './memory.js';

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

// Contexte envoyé par le studio (jamais de photo) : personnalités résumées et versions du CV, bornés.
function cleanContext(raw) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  const personas = (Array.isArray(raw?.personas) ? raw.personas : []).slice(0, 20).map((p) => ({
    name: str(p?.name, 80),
    title: str(p?.title, 120),
    summary: str(p?.summary, 600),
    education: (Array.isArray(p?.education) ? p.education : []).slice(0, 8).map((e) => str(e, 160)),
    experiences: (Array.isArray(p?.experiences) ? p.experiences : []).slice(0, 8).map((e) => str(e, 160)),
  }));
  const versions = (Array.isArray(raw?.versions) ? raw.versions : [])
    .slice(0, 30)
    .map((v) => ({ key: str(v?.key, 60), label: str(v?.label, 120) }))
    .filter((v) => v.key);
  // Modèle du CV et s'il a déjà été choisi par l'utilisateur (sinon, l'agent peut en proposer).
  const template = { id: str(raw?.template?.id, 40).replace(/[^a-z0-9-]/g, ''), chosen: raw?.template?.chosen === true };
  return { personas, versions, template };
}

// payload = { state, message, history?, scope?, context? }. callModel est injectable (tests sans réseau).
// username : compte connecté (mémoire, crédits) ou null pour un visiteur.
// skills : liste à utiliser à la place des skills de l'admin (test d'une skill avant de l'enregistrer).
export async function handle(payload, { callModel, readModel, env = process.env, keySource = null, username = null, skills = null, countSkills = true } = {}) {
  // « Confirmer » touché : on applique le changement en attente (signé) au CV tel qu'il était. Aucun appel au modèle.
  if (payload?.confirm) return confirmPending(payload, { username, env });
  let message = String(payload?.message ?? '').trim();
  const asked = message; // la demande telle que l'utilisateur l'a écrite (pour les garde-fous)
  const pic = checkImage(payload?.image);
  if (!pic.ok) return { ok: false, status: 400, error: pic.error };
  if (!message && !pic.image) return { ok: false, status: 400, error: 'Message vide.' };
  // Image jointe : lue une seule fois (texte), puis l'agent travaille sur ce texte comme sur un message.
  if (pic.image) {
    let text;
    try {
      text = await readImage(pic.image, { env, keySource, timeoutMs: settings.llmTimeoutMs * 2, callModel: readModel });
    } catch (err) {
      console.error(`[vision] ${redact(err.message, [...(keySource?.secrets() ?? []), ...allKeys(env)])}`);
      return { ok: false, status: 503, error: err.userMessage ?? 'Je n’ai pas pu lire cette image. Réessaie, ou écris tes informations.' };
    }
    if (!text) return { ok: false, status: 502, error: 'Je n’ai rien pu lire sur cette image. Essaie une photo plus nette.' };
    message = withImageText(message, text);
  }

  const context = cleanContext(payload?.context);
  const memory = username ? await listMemory(username).catch(() => []) : [];
  const run = { state: normalize(payload.state), changes: new Set(), flags: {}, username, context, memory, generate: null };
  // Garde-fous : ce que l'utilisateur a réellement demandé, et tout ce qu'il a fourni (coordonnées jamais inventées).
  run.userText = asked;
  const userTurns = (Array.isArray(payload.history) ? payload.history : []).filter((t) => t?.role === 'user').map((t) => String(t.text ?? ''));
  run.sources = [message, ...userTurns, run.state.profile.email, ...run.state.profile.phones].join('\n');
  setExtraSkills(skills ?? (await customSkills())); // skills ajoutées depuis l'admin
  run.countSkills = countSkills;
  const scope = SCOPES[payload.scope] ? payload.scope : null;
  const { specs: toolSpecs, tools } = scopedTools(scope);
  const said = scope
    ? `[Section en cours : ${SCOPES[scope].label}. Tu ne modifies que cette section. S'il manque une information importante, pose UNE question courte au lieu d'inventer. Tes modifications sont une PROPOSITION : l'utilisateur la voit dans son formulaire et choisit de la garder ou non. Dans ta réponse, dis « Je te propose… » et invite-le à relire puis garder ; ne dis jamais « c'est fait » ni « j'ai ajouté ».]\n\n${message}`
    : message;
  const tune = await agentTuning(env);
  run.maxSkills = tune.maxSkills;
  const messages = build(run.state, said, payload.history, scope ? { historySent: tune.historySent } : { versions: context.versions, memory, loggedIn: Boolean(username), historySent: tune.historySent, template: context.template });
  const secrets = [...(keySource?.secrets() ?? []), ...allKeys(env)];
  callModel ??= (msgs, sp) => callLLM(msgs, sp, { temperature: settings.temperature, timeoutMs: settings.llmTimeoutMs, env, keySource });

  let reply;
  try {
    const overBudget = () => tune.maxTokensPerRequest > 0 && (keySource?.tokens ?? 0) >= tune.maxTokensPerRequest;
    reply = await runLoop(run, messages, toolSpecs, tools, callModel, tune.maxSteps, overBudget);
  } catch (err) {
    console.error(`[LLM] ${redact(err.message, secrets)}`);
    if (err instanceof LLMError || err.name === 'TimeoutError') {
      return { ok: false, status: 503, error: err.userMessage ?? "L'assistant est indisponible pour le moment. Réessaie dans un instant." };
    }
    return { ok: false, status: 502, error: "L'assistant a rencontré un problème. Réessaie." };
  }
  const pending = sealPending(run, env);
  return {
    ok: true,
    reply: redact(reply, secrets),
    state: compact(run.state),
    changes: [...run.changes].sort(),
    ...(run.generate ? { generate: run.generate } : {}),
    ...(run.templates ? { templates: run.templates } : {}),
    ...(run.skills?.length ? { skills: run.skills } : {}),
    ...(pending ? { pending } : {}),
  };
}

async function confirmPending(payload, { username, env }) {
  const state = normalize(payload.state);
  const opened = openPending(payload.confirm, state, username, env);
  if (!opened.ok) return { ok: false, status: 409, error: opened.error };
  const run = { state, changes: new Set(), flags: {}, username, context: {}, memory: [] };
  for (const op of opened.ops) {
    const tool = byName.get(op.tool);
    const r = tool ? await tool.run(run, op.args ?? {}) : { error: 'Outil inconnu.' };
    if (r?.error) return { ok: false, status: 409, error: 'Ce changement ne s’applique plus à ton CV : redemande à l’assistant.' };
  }
  return { ok: true, reply: 'C’est fait.', state: compact(run.state), changes: [...run.changes].sort(), confirmed: true };
}
