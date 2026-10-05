// Appel d'un fournisseur OpenAI-compatible, avec bascule de clé (puis de fournisseur) sur 429.
import { markExhausted, masked, nextKey } from './providers.js';

// userMessage : phrase à montrer à l'utilisateur (sinon un message générique).
export class LLMError extends Error {
  constructor(message, { userMessage } = {}) {
    super(message);
    this.userMessage = userMessage;
  }
}

const isRateLimit = (status, detail) => status === 429 || /rate limit|quota|resource_exhausted/i.test(detail);

// keySource : le pool de clés de l'utilisateur (voir server/keys/pool.js) ; sans lui, les clés d'environnement.
export async function callLLM(messages, tools, { temperature = 0.3, timeoutMs = 60000, env = process.env, fetchImpl = fetch, keySource = null } = {}) {
  for (;;) {
    const next = keySource ? keySource.next() : nextKey(env);
    if (!next) {
      throw new LLMError('aucun fournisseur disponible (clés absentes ou toutes épuisées)', {
        userMessage:
          keySource?.mode === 'own'
            ? 'L’assistant est momentanément indisponible pour ton compte. Réessaie un peu plus tard, ou contacte salacv.'
            : "L'assistant est indisponible pour le moment. Réessaie dans un instant.",
      });
    }
    const { provider, key } = next;
    const body = { model: provider.model, messages, temperature };
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: t }));

    let res;
    try {
      res = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'User-Agent': 'salacv-agent/1.0', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new LLMError(`${provider.name} injoignable (${err.name === 'TimeoutError' ? 'délai dépassé' : err.message})`);
    }
    if (res.ok) {
      keySource?.used(next);
      return res.json();
    }
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (isRateLimit(res.status, detail)) {
      console.log(`[429] clé ${masked(key)} de ${provider.name} épuisée, clé suivante`);
      if (keySource) await keySource.exhaust(next);
      else markExhausted(key);
      continue;
    }
    // Clé refusée (supprimée, mal copiée) : on la désactive et on tente la suivante.
    if (keySource && (res.status === 401 || res.status === 403)) {
      console.log(`[${res.status}] clé ${masked(key)} de ${provider.name} refusée, désactivée`);
      await keySource.invalid(next);
      continue;
    }
    throw new LLMError(`${provider.name} a répondu ${res.status}`);
  }
}
