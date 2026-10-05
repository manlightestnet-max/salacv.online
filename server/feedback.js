// Avis (note + mot) de n'importe quel utilisateur, connecté ou non : enregistrés côté serveur et comptés dans
// les statistiques de la landing page. Un avis par personne (compte, sinon session), modifiable ; au plus
// 5 avis nouveaux par adresse IP et par jour (l'IP n'est gardée que sous forme d'empreinte).
import { createHash } from 'node:crypto';
import { query } from './db/index.js';
import { verify } from './agent/auth.js';

const DAILY_PER_IP = 5;
const ipHash = (ip, env) => createHash('sha256').update(`${env.SALACV_SESSION_SECRET ?? ''}|ip|${ip}`).digest('hex').slice(0, 32);

// → [statut, corps]
export async function feedback(payload, token, { env = process.env, ctx } = {}) {
  const username = token ? verify(token, env) : null;
  if (token && !username) return [401, { ok: false, error: 'Ta session a expiré. Reconnecte-toi.' }];
  if (!username && !ctx) return [400, { ok: false, error: 'Requête invalide.' }];
  const stars = Number(payload?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return [400, { ok: false, error: 'Note invalide.' }];
  const comment = String(payload?.comment ?? '').trim().slice(0, 500);
  const subject = username ? `user:${username}` : `sid:${ctx.sid}`;
  const hash = ipHash(ctx?.ip ?? 'inconnue', env);

  const existing = await query('SELECT 1 FROM feedback WHERE subject = $1', [subject]);
  if (!existing.length) {
    const [{ n }] = await query(`SELECT count(*)::int AS n FROM feedback WHERE ip_hash = $1 AND created_at > now() - interval '1 day'`, [hash]);
    if (n >= DAILY_PER_IP) return [429, { ok: false, error: 'Trop d’avis depuis ce réseau aujourd’hui. Merci, réessaie demain.' }];
  }
  await query(
    `INSERT INTO feedback (subject, stars, comment, ip_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (subject) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment, updated_at = now()`,
    [subject, stars, comment, hash],
  );
  return [200, { ok: true, ...(await stats()) }];
}

// Statistiques publiques de la landing : seulement des chiffres réels (rien quand il n'y a rien).
export async function stats() {
  const [r] = await query('SELECT count(*)::int AS n, avg(stars)::float AS avg FROM feedback');
  const [c] = await query('SELECT count(*)::int AS n FROM render_log');
  return {
    rating: r.n > 0 ? { average: Math.round(r.avg * 10) / 10, count: r.n } : null,
    cvs: c.n,
  };
}

export const statsRoute = async () => [200, { ok: true, ...(await stats()) }];
