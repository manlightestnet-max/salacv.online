// Stockage de l'admin (modèles, skills, ressources, journal, CV d'essai) : sur Postgres, comme le reste
// (Neon en production, PGlite en local — voir server/db/index.js).
//
// API : get(key, fallback), set(key, value), push(key, item, max), range(key, n), durable.
import { pgStore } from './db/kvstore.js';

let current = null;
export function store() {
  current ??= pgStore();
  return current;
}

// Tests : stockage en mémoire.
export function memoryStore() {
  const data = new Map();
  current = {
    durable: false,
    get: async (k, f) => (data.has(k) ? structuredClone(data.get(k)) : f),
    set: async (k, v) => void data.set(k, structuredClone(v)),
    push: async (k, item, max) => void data.set(k, [item, ...(data.get(k) ?? [])].slice(0, max)),
    range: async (k, n) => (data.get(k) ?? []).slice(0, n),
  };
  return current;
}
