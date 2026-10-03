// Réglages lus dans l'environnement. Aucune clé n'est jamais écrite dans le code ou le repo.
const int = (name, def) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : def;
};

export const settings = {
  get maxIterations() {
    return int('AGENT_MAX_ITERATIONS', 8);
  },
  temperature: 0.3,
  get llmTimeoutMs() {
    return int('AGENT_TIMEOUT', 25) * 1000;
  },
  // Requêtes à l'agent traitées en même temps par ce process ; au-delà : 503 propre.
  get concurrency() {
    return int('AGENT_CONCURRENCY', 8);
  },
  get ratePerMinute() {
    return int('AGENT_RATE_PER_MINUTE', 6);
  },
};
