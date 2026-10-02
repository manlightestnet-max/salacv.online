// Une requête = une exécution : CV + message → CV modifié + réponse.
import { settings } from './config.js';
import { callLLM, LLMError } from './llm/client.js';
import { allKeys } from './llm/providers.js';
import { build } from './prompt.js';
import { runLoop } from './loop.js';
import { redact } from './secrets.js';
import { compact, normalize } from './state.js';
import { byName, specs } from './tools/index.js';

// payload = { state, message, history? }. callModel est injectable (tests sans réseau).
export async function handle(payload, { callModel, env = process.env } = {}) {
  const message = String(payload?.message ?? '').trim();
  if (!message) return { ok: false, status: 400, error: 'Message vide.' };

  const run = { state: normalize(payload.state), changes: new Set(), flags: {} };
  const messages = build(run.state, message, payload.history);
  const secrets = allKeys(env);
  callModel ??= (msgs, sp) => callLLM(msgs, sp, { temperature: settings.temperature, timeoutMs: settings.llmTimeoutMs, env });

  let reply;
  try {
    reply = await runLoop(run, messages, specs(), byName, callModel, settings.maxIterations);
  } catch (err) {
    console.error(`[LLM] ${redact(err.message, secrets)}`);
    if (err instanceof LLMError || err.name === 'TimeoutError') {
      return { ok: false, status: 503, error: "L'assistant est indisponible pour le moment. Réessaie dans un instant." };
    }
    return { ok: false, status: 502, error: "L'assistant a rencontré un problème. Réessaie." };
  }
  return { ok: true, reply: redact(reply, secrets), state: compact(run.state), changes: [...run.changes].sort() };
}
