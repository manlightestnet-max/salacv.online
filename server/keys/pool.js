// Pool de clés des fournisseurs IA, avec rotation.
//
//   • Pool partagé : les clés de l'admin (owner = NULL), pour tous les clients.
//   • Clés attribuées : l'admin peut dédier une ou plusieurs clés à un client précis.
//     RÈGLE : dès qu'un client a une clé attribuée, il ne consomme QUE les siennes, jamais le pool.
//   Les clients ne voient ni ne gèrent jamais de clé : c'est salacv qui fournit l'IA.
//   • Rotation : première clé utilisable dans l'ordre des fournisseurs ; sur 429 elle est marquée épuisée
//     pour la journée (en base : toutes les instances le savent) et on passe à la suivante ; sur 401/403
//     elle est désactivée (clé invalide).
// Les secrets sont chiffrés en base (AES-256-GCM) et ne sortent jamais vers un navigateur.
import { query } from '../db/index.js';
import { fingerprint, last4, open, seal } from '../crypto.js';
import { PROVIDERS, keysFor, resolveProvider } from '../agent/llm/providers.js';

export class KeyError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);
const providerNames = () => PROVIDERS.map((p) => p.name);
const rank = (name) => providerNames().indexOf(name);

const COLUMNS = 'id, provider, label, last4, owner, origin, public, disabled, disabled_reason, exhausted_on, created_by, created_at, assigned_at';
const view = (r) => ({
  id: Number(r.id),
  provider: r.provider,
  label: r.label,
  last4: r.last4,
  owner: r.owner,
  origin: r.origin,
  public: r.public,
  disabled: r.disabled,
  disabledReason: r.disabled_reason,
  exhaustedToday: r.exhausted_on ? String(new Date(r.exhausted_on).toISOString().slice(0, 10)) === today() : false,
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).getTime(),
  assignedAt: r.assigned_at ? new Date(r.assigned_at).getTime() : null,
});

export const providers = () => providerNames();

// --- Gestion (admin et utilisateurs) ------------------------------------------------------

export async function addKey({ provider, secret, label = '', owner = null, createdBy, public: isPublic = false }, env = process.env) {
  if (isPublic && owner) throw new KeyError('Une clé attribuée à un client ne peut pas être publique.');
  if (!providerNames().includes(provider)) throw new KeyError('Fournisseur inconnu.');
  const value = String(secret ?? '').trim();
  if (value.length < 8 || value.length > 400 || /\s/.test(value)) throw new KeyError('Clé invalide : 8 à 400 caractères, sans espace.');
  const hash = fingerprint(value);
  if ((await query('SELECT 1 FROM api_keys WHERE secret_hash = $1', [hash])).length) throw new KeyError('Cette clé existe déjà.');
  const rows = await query(
    `INSERT INTO api_keys (provider, label, secret_enc, secret_hash, last4, owner, origin, created_by, public, assigned_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7, $8, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END)
     RETURNING ${COLUMNS}`,
    [provider, String(label).slice(0, 60), seal(value, env), hash, last4(value), owner, createdBy, Boolean(isPublic)],
  );
  return view(rows[0]);
}

// `env` (admin) : signale aussi les clés chiffrées avec une ancienne clé maîtresse (illisibles, jamais utilisées).
export async function listKeys({ owner, env } = {}) {
  const cols = env ? `${COLUMNS}, secret_enc` : COLUMNS;
  const rows = owner === undefined
    ? await query(`SELECT ${cols} FROM api_keys ORDER BY owner NULLS FIRST, id`)
    : await query(`SELECT ${cols} FROM api_keys WHERE owner = $1 ORDER BY id`, [owner]);
  return rows.map((r) => {
    if (!env) return view(r);
    let unreadable = false;
    try {
      open(r.secret_enc, env);
    } catch {
      unreadable = true;
    }
    return { ...view(r), unreadable };
  });
}

// Attribue une clé à un utilisateur ; owner = null la remet dans le pool partagé.
export async function assignKey(id, owner) {
  const rows = await query(
    `UPDATE api_keys SET owner = $2, origin = 'admin', public = CASE WHEN $2::text IS NULL THEN public ELSE false END, assigned_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, exhausted_on = NULL
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, owner],
  );
  if (!rows.length) throw new KeyError('Clé introuvable.');
  return view(rows[0]);
}

// Étiquette « public » : la clé sert aux visiteurs non connectés (pool uniquement, jamais une clé attribuée).
export async function setKeyPublic(id, isPublic) {
  const rows = await query('UPDATE api_keys SET public = $2, exhausted_on = NULL WHERE id = $1 AND owner IS NULL RETURNING id', [id, Boolean(isPublic)]);
  if (!rows.length) throw new KeyError('Clé introuvable, ou attribuée à un client (seules les clés du pool peuvent être publiques).');
}

export async function setKeyDisabled(id, disabled, reason = '') {
  const rows = await query('UPDATE api_keys SET disabled = $2, disabled_reason = $3, exhausted_on = NULL WHERE id = $1 RETURNING id', [id, disabled, disabled ? String(reason).slice(0, 120) : '']);
  if (!rows.length) throw new KeyError('Clé introuvable.');
}

export async function deleteKey(id) {
  const rows = await query('DELETE FROM api_keys WHERE id = $1 RETURNING id', [id]);
  if (!rows.length) throw new KeyError('Clé introuvable.');
}

// --- Rotation ------------------------------------------------------------------------------

// Source de clés pour UNE requête : next() donne le prochain couple fournisseur + clé, exhaust() / invalid()
// retirent la clé fautive, used() retient laquelle a servi et combien de tokens elle a coûté (journal, quotas).
//   anonymous : visiteur non connecté → UNIQUEMENT les clés étiquetées « public » (jamais celles des clients ni l'environnement).
//   connecté  : ses clés attribuées s'il en a ; sinon le pool ; sinon les clés « public » ; sinon l'environnement (secours).
export async function keySourceFor(username, env = process.env, { anonymous = false } = {}) {
  const pick = (where, params = []) => query(`SELECT id, provider, secret_enc, exhausted_on FROM api_keys WHERE disabled = false AND ${where} ORDER BY id`, params);
  const any = async (where, params = []) => (await query(`SELECT 1 FROM api_keys WHERE ${where} LIMIT 1`, params)).length > 0;

  let rows;
  let mode;
  if (anonymous) {
    rows = await pick('owner IS NULL AND public = true');
    mode = 'public';
  } else if (await any('owner = $1', [username])) {
    rows = await pick('owner = $1', [username]);
    mode = 'own';
  } else if (await any('owner IS NULL AND public = false')) {
    rows = await pick('owner IS NULL AND public = false');
    mode = 'pool';
  } else if (await any('owner IS NULL AND public = true')) {
    rows = await pick('owner IS NULL AND public = true');
    mode = 'public';
  } else {
    rows = [];
    mode = 'env';
  }

  const skip = new Set();
  const list = [];
  for (const r of rows) {
    if (r.exhausted_on && String(new Date(r.exhausted_on).toISOString().slice(0, 10)) === today()) continue;
    try {
      list.push({ id: Number(r.id), provider: r.provider, secret: open(r.secret_enc, env) });
    } catch (err) {
      console.error(`[clés] clé ${r.id} illisible : ${err.message}`);
    }
  }
  // Aucune clé enregistrée : les clés d'environnement servent de secours aux utilisateurs connectés (démarrage, développement).
  if (mode === 'env') for (const p of PROVIDERS) for (const k of keysFor(p.name, env)) list.push({ id: null, provider: p.name, secret: k });
  list.sort((a, b) => rank(a.provider) - rank(b.provider));

  const providerOf = (name) => resolveProvider(PROVIDERS.find((p) => p.name === name), env);
  return {
    mode,
    lastUsedId: null,
    tokens: 0,
    next() {
      const e = list.find((k) => !skip.has(k.secret));
      return e ? { provider: providerOf(e.provider), key: e.secret, id: e.id } : null;
    },
    async exhaust(entry) {
      skip.add(entry.key);
      if (entry.id) await query('UPDATE api_keys SET exhausted_on = CURRENT_DATE WHERE id = $1', [entry.id]).catch(() => {});
    },
    async invalid(entry) {
      skip.add(entry.key);
      if (entry.id) await query(`UPDATE api_keys SET disabled = true, disabled_reason = 'refusée par le fournisseur (401/403)' WHERE id = $1`, [entry.id]).catch(() => {});
    },
    used(entry, tokens = 0) {
      this.lastUsedId = entry.id;
      this.tokens += Math.max(0, Math.round(Number(tokens) || 0));
    },
    secrets: () => list.map((k) => k.secret), // pour masquer toute fuite dans les journaux et les réponses
  };
}

export async function logUsage(username, keyId, kind, ok, tokens = 0) {
  await query('INSERT INTO ai_usage (username, key_id, kind, ok, tokens) VALUES ($1, $2, $3, $4, $5)', [username, keyId, kind, ok, Math.round(tokens) || 0]).catch(() => {});
}
