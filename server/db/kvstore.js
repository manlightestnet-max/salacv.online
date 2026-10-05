// Stockage clé/valeur et listes sur Postgres (mêmes méthodes qu'avant : get, set, push, range).
import { query } from './index.js';

export function pgStore() {
  return {
    durable: true,
    async get(key, fallback) {
      const rows = await query('SELECT value FROM kv WHERE key = $1', [key]);
      return rows.length ? rows[0].value : fallback;
    },
    async set(key, value) {
      await query(
        'INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
        [key, JSON.stringify(value)],
      );
    },
    // Liste : le plus récent en premier, bornée à `max` éléments.
    async push(key, item, max) {
      await query('INSERT INTO kv_list (key, value) VALUES ($1, $2::jsonb)', [key, JSON.stringify(item)]);
      await query('DELETE FROM kv_list WHERE key = $1 AND id NOT IN (SELECT id FROM kv_list WHERE key = $1 ORDER BY id DESC LIMIT $2)', [key, max]);
    },
    async range(key, n) {
      const rows = await query('SELECT value FROM kv_list WHERE key = $1 ORDER BY id DESC LIMIT $2', [key, n]);
      return rows.map((r) => r.value);
    },
  };
}
