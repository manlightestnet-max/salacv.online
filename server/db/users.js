// Comptes (table users) : une ligne par utilisateur, mises à jour atomiques (pas de « lire puis réécrire
// toute la liste » : deux connexions en même temps ne s'écrasent plus).
import { query } from './index.js';

const shape = (r) => ({
  username: r.username,
  name: r.name,
  first: new Date(r.first_at).getTime(),
  last: new Date(r.last_at).getTime(),
  logins: Number(r.logins),
  blocked: r.blocked,
  reason: r.reason,
  aiAccess: r.ai_access,
});

// Connexion réussie : crée le compte (accès à l'IA accordé d'office) ou met à jour son passage.
// Un compte bloqué n'est pas modifié. → { blocked, aiAccess }
export async function recordLogin(username, { name = '' } = {}) {
  const rows = await query(
    `INSERT INTO users (username, name, logins) VALUES ($1, $2, 1)
     ON CONFLICT (username) DO UPDATE
       SET last_at = now(), logins = users.logins + 1, name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE users.name END
       WHERE users.blocked = false
     RETURNING blocked, ai_access`,
    [username, String(name).slice(0, 80)],
  );
  if (rows.length) return { blocked: false, aiAccess: rows[0].ai_access };
  return { blocked: true, aiAccess: false };
}

export async function getUser(username) {
  const rows = await query('SELECT * FROM users WHERE username = $1', [username]);
  return rows.length ? shape(rows[0]) : null;
}

export const isBlocked = async (username) => Boolean((await getUser(username))?.blocked);

export async function listUsers() {
  return (await query('SELECT * FROM users ORDER BY last_at DESC')).map(shape);
}

export async function setBlocked(username, blocked, reason = '') {
  const rows = await query('UPDATE users SET blocked = $2, reason = $3 WHERE username = $1 RETURNING username', [username, blocked, blocked ? String(reason).slice(0, 200) : '']);
  return rows.length > 0;
}

export async function setAiAccess(username, allowed) {
  const rows = await query('UPDATE users SET ai_access = $2 WHERE username = $1 RETURNING username', [username, Boolean(allowed)]);
  return rows.length > 0;
}

export async function userStats(now = Date.now()) {
  const week = new Date(now - 7 * 86400000).toISOString();
  const [r] = await query(
    `SELECT count(*)::int AS users,
            count(*) FILTER (WHERE blocked)::int AS blocked,
            count(*) FILTER (WHERE last_at >= $1)::int AS active7,
            count(*) FILTER (WHERE first_at >= $1)::int AS new7
     FROM users`,
    [week],
  );
  return r;
}
