// Fournisseurs OpenAI-compatibles. Les URL et modèles sont ici ; les clés viennent
// UNIQUEMENT de l'environnement : <NOM>_API_KEYS (séparées par des virgules) ou
// <NOM>_API_KEY, ex. OLLAMA_API_KEY. Le premier fournisseur ayant une clé est utilisé,
// les suivants servent de secours. URL et modèle : <NOM>_BASE_URL, <NOM>_MODEL.
export const PROVIDERS = [
  { name: 'ollama', baseUrl: 'https://ollama.com/v1', model: 'gemma4:31b-cloud' },
  { name: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
];

// Clés épuisées (429) aujourd'hui, partagées par toutes les requêtes du process.
const exhausted = new Map(); // clé -> jour (AAAA-MM-JJ)
const today = () => new Date().toISOString().slice(0, 10);

export function keysFor(name, env = process.env) {
  const prefix = name.toUpperCase().replace(/-/g, '_');
  const raw = env[`${prefix}_API_KEYS`] || env[`${prefix}_API_KEY`] || '';
  return raw.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
}

export function allKeys(env = process.env) {
  return PROVIDERS.flatMap((p) => keysFor(p.name, env));
}

export function markExhausted(key) {
  exhausted.set(key, today());
}

// URL et modèle surchargeables sans toucher au code : <NOM>_BASE_URL, <NOM>_MODEL.
export function resolveProvider(provider, env) {
  const prefix = provider.name.toUpperCase();
  return { ...provider, baseUrl: env[`${prefix}_BASE_URL`] || provider.baseUrl, model: env[`${prefix}_MODEL`] || provider.model };
}

// Prochain couple fournisseur + clé utilisable, ou null.
export function nextKey(env = process.env) {
  const day = today();
  for (const provider of PROVIDERS) {
    const key = keysFor(provider.name, env).find((k) => exhausted.get(k) !== day);
    if (key) return { provider: resolveProvider(provider, env), key };
  }
  return null;
}

export const masked = (key) => (key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-3)}` : '***');

export function resetExhausted() {
  exhausted.clear();
}
