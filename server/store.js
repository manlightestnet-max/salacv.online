// Stockage de l'admin (utilisateurs, CV d'essai, ressources, skills), sans base de données.
//
// - Upstash Redis (REST) si UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN sont définis :
//   persistant, et indispensable sur Vercel (le disque des fonctions n'est pas gardé).
// - Sinon un fichier JSON par clé dans SALACV_DATA_DIR (défaut : ./data) : parfait sur le VPS.
//
// API : get(key, fallback), set(key, value), push(key, item, max), range(key, n), durable.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PREFIX = 'salacv:';

function upstash(env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const call = async (command) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    if (!res.ok) throw new Error(`stockage : HTTP ${res.status}`);
    return (await res.json()).result;
  };
  return {
    durable: true,
    async get(key, fallback) {
      const raw = await call(['GET', PREFIX + key]);
      return raw == null ? fallback : JSON.parse(raw);
    },
    async set(key, value) {
      await call(['SET', PREFIX + key, JSON.stringify(value)]);
    },
    // Liste : le plus récent en premier, bornée à `max` éléments.
    async push(key, item, max) {
      await call(['LPUSH', PREFIX + key, JSON.stringify(item)]);
      await call(['LTRIM', PREFIX + key, 0, max - 1]);
    },
    async range(key, n) {
      return (await call(['LRANGE', PREFIX + key, 0, n - 1])).map((x) => JSON.parse(x));
    },
  };
}

function files(env) {
  const dir = path.resolve(env.SALACV_DATA_DIR || 'data');
  const file = (key) => path.join(dir, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  // Écritures en série (un process) et atomiques (fichier temporaire puis renommage).
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));
  const read = async (key, fallback) => {
    try {
      return JSON.parse(await readFile(file(key), 'utf8'));
    } catch {
      return fallback;
    }
  };
  const write = async (key, value) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${file(key)}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file(key));
  };
  return {
    durable: !process.env.VERCEL,
    get: read,
    set: (key, value) => serial(() => write(key, value)),
    push: (key, item, max) => serial(async () => write(key, [item, ...(await read(key, []))].slice(0, max))),
    range: async (key, n) => (await read(key, [])).slice(0, n),
  };
}

let current = null;
export function store(env = process.env) {
  current ??= upstash(env) ?? files(env);
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
