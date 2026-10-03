// Appel d'un fournisseur OpenAI-compatible, avec bascule de clé (puis de fournisseur) sur 429.
import { markExhausted, masked, nextKey } from './providers.js';

export class LLMError extends Error {}

const isRateLimit = (status, detail) => status === 429 || /rate limit|quota|resource_exhausted/i.test(detail);

export async function callLLM(messages, tools, { temperature = 0.3, timeoutMs = 60000, env = process.env, fetchImpl = fetch } = {}) {
  for (;;) {
    const next = nextKey(env);
    if (!next) throw new LLMError('aucun fournisseur disponible (clés absentes ou toutes épuisées)');
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
    if (res.ok) return res.json();
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (isRateLimit(res.status, detail)) {
      console.log(`[429] clé ${masked(key)} de ${provider.name} épuisée, clé suivante`);
      markExhausted(key);
      continue;
    }
    throw new LLMError(`${provider.name} a répondu ${res.status}`);
  }
}
