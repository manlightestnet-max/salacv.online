// CV des comptes connectés : le contenu est écrit UNIQUEMENT sur Cloudflare R2, dans le dossier du compte (u/<empreinte>/…) ;
// la table `projects` ne garde que l'index (identifiant, dates, taille). Rien n'est gardé dans le navigateur. Un visiteur non
// connecté n'a aucune sauvegarde. Sans R2 configuré, l'enregistrement est refusé avec un message clair (aucun repli silencieux).
import { query } from './db/index.js';
import { verify } from './agent/auth.js';
import { getUser } from './db/users.js';
import { RateLimiter } from './ratelimit.js';
import { r2Configured, r2Delete, r2Get, r2Put, userPrefix } from './r2.js';

export const MAX_PROJECTS = 100;
export const MAX_PROJECT_BYTES = 600 * 1024; // un CV avec photo
export const MAX_PROJECTS_BODY = 700 * 1024;
const ID = /^[a-z0-9]{4,24}$/;
const KINDS = new Set(['cv', 'persona']);
const saveLimiter = new RateLimiter(120);

const keyOf = (username, kind, id) => `${userPrefix(username)}/${kind}/${id}.json`;

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

export async function listProjects(username, opts = {}) {
  const rows = await query('SELECT id, kind, data, r2_key, created_at, updated_at FROM projects WHERE username = $1 ORDER BY updated_at DESC LIMIT $2', [username, MAX_PROJECTS * 2]);
  const items = await mapLimit(rows, 8, async (r) => {
    let data = r.data;
    if (data == null && r.r2_key) {
      try {
        const raw = await r2Get(r.r2_key, opts);
        data = raw ? JSON.parse(raw.toString('utf8')) : null;
      } catch (err) {
        console.error(`[projets] lecture R2 impossible (${r.id}) : ${err.message}`);
      }
    }
    return data == null ? null : { id: r.id, kind: r.kind, data, createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime() };
  });
  return items.filter(Boolean);
}

// → { ok } | { ok: false, status, error }
export async function saveProject(username, { id, kind = 'cv', data, createdAt }, opts = {}) {
  if (!ID.test(String(id ?? ''))) return { ok: false, status: 400, error: 'Identifiant de CV invalide.' };
  if (!KINDS.has(kind)) return { ok: false, status: 400, error: 'Type invalide.' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, status: 400, error: 'CV invalide.' };
  const json = JSON.stringify(data);
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_PROJECT_BYTES) return { ok: false, status: 413, error: 'Ce CV est trop lourd (photo trop grande ?).' };

  const existing = await query('SELECT r2_key FROM projects WHERE username = $1 AND id = $2', [username, id]);
  if (!existing.length) {
    const [{ n }] = await query('SELECT count(*)::int AS n FROM projects WHERE username = $1', [username]);
    if (n >= MAX_PROJECTS) return { ok: false, status: 400, error: `Tu as atteint la limite de ${MAX_PROJECTS} CV. Supprime-en pour en créer d’autres.` };
  }

  if (!(await r2Configured(opts.env))) return { ok: false, status: 503, error: 'Le stockage des CV n’est pas encore configuré par l’administrateur (Cloudflare R2).' };
  const key = keyOf(username, kind, id);
  await r2Put(key, json, 'application/json', opts);
  await query(
    `INSERT INTO projects (username, id, kind, data, r2_key, bytes, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, to_timestamp($7 / 1000.0))
     ON CONFLICT (username, id) DO UPDATE SET kind = EXCLUDED.kind, data = EXCLUDED.data, r2_key = EXCLUDED.r2_key, bytes = EXCLUDED.bytes, updated_at = now()`,
    [username, id, kind, null, key, bytes, Number.isFinite(createdAt) ? createdAt : Date.now()],
  );
  return { ok: true };
}

export async function deleteProject(username, id, opts = {}) {
  const rows = await query('DELETE FROM projects WHERE username = $1 AND id = $2 RETURNING r2_key', [username, String(id)]);
  if (rows[0]?.r2_key) await r2Delete(rows[0].r2_key, opts).catch((err) => console.error(`[projets] suppression R2 : ${err.message}`));
  return rows.length > 0;
}

// POST /api/projects { action: 'list' | 'save' | 'delete', … } — connexion obligatoire.
export async function projectsRoute(payload, token, { env = process.env, ...opts } = {}) {
  const username = token ? verify(token, env) : null;
  if (!username) return [401, { ok: false, error: 'Connecte-toi pour sauvegarder tes CV.' }];
  if ((await getUser(username).catch(() => null))?.blocked) return [403, { ok: false, error: 'Ce compte est suspendu.' }];
  const o = { env, ...opts };
  switch (String(payload?.action ?? 'list')) {
    case 'list':
      return [200, { ok: true, storage: await r2Configured(env), items: await listProjects(username, o) }];
    case 'save': {
      if (!saveLimiter.allow(username)) return [429, { ok: false, error: 'Trop d’enregistrements. Réessaie dans un instant.' }];
      const r = await saveProject(username, payload, o);
      return [r.ok ? 200 : r.status, r.ok ? { ok: true } : { ok: false, error: r.error }];
    }
    case 'delete':
      return [200, { ok: true, deleted: await deleteProject(username, payload.id, o) }];
    default:
      return [400, { ok: false, error: 'Action inconnue.' }];
  }
}
