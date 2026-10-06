// Mémoire de l'agent : ce que l'utilisateur lui a demandé de retenir (« écris toujours mes dates en mois et année »,
// « je vise la banque »…). Toujours en base (table agent_memory), par compte ; jamais dans le navigateur.
// Un visiteur non connecté n'a pas de mémoire.
import { query } from '../db/index.js';

export const MAX_ITEMS = 30;
const KEY = /^[\p{L}\p{N} _'’-]{1,60}$/u;

export async function listMemory(username) {
  if (!username) return [];
  const rows = await query('SELECT key, value FROM agent_memory WHERE username = $1 ORDER BY updated_at DESC LIMIT $2', [username, MAX_ITEMS]);
  return rows.map((r) => ({ key: r.key, value: r.value }));
}

// → { ok } | { error }
export async function remember(username, key, value) {
  if (!username) return { error: 'Mémoire réservée aux comptes connectés.' };
  const k = String(key ?? '').trim();
  const v = String(value ?? '').trim().slice(0, 300);
  if (!KEY.test(k) || !v) return { error: 'Clé (60 caractères max) et valeur obligatoires.' };
  const [{ n }] = await query('SELECT count(*)::int AS n FROM agent_memory WHERE username = $1 AND key <> $2', [username, k]);
  if (n >= MAX_ITEMS) return { error: `Mémoire pleine (${MAX_ITEMS} préférences) : oublie-en une d'abord.` };
  await query(
    `INSERT INTO agent_memory (username, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (username, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [username, k, v],
  );
  return { ok: true };
}

export async function forget(username, key) {
  if (!username) return { error: 'Mémoire réservée aux comptes connectés.' };
  const rows = await query('DELETE FROM agent_memory WHERE username = $1 AND key = $2 RETURNING key', [username, String(key ?? '').trim()]);
  return rows.length ? { ok: true } : { error: 'Aucune préférence de ce nom.' };
}
