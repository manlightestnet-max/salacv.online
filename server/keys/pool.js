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

const COLUMNS = 'id, provider, label, last4, owner, origin, disabled, disabled_reason, exhausted_on, created_by, created_at, assigned_at';
const view = (r) => ({
  id: Number(r.id),
  provider: r.provider,
  label: r.label,
  last4: r.last4,
  owner: r.owner,
  origin: r.origin,
  disabled: r.disabled,
  disabledReason: r.disabled_reason,
  exhaustedToday: r.exhausted_on ? String(new Date(r.exhausted_on).toISOString().slice(0, 10)) === today() : false,
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).getTime(),
  assignedAt: r.assigned_at ? new Date(r.assigned_at).getTime() : null,
});

export const providers = () => providerNames();

// --- Gestion (admin et utilisateurs) ------------------------------------------------------

export async function addKey({ provider, secret, label = '', owner = null, createdBy }, env = process.env) {
  if (!providerNames().includes(provider)) throw new KeyError('Fournisseur inconnu.');
  const value = String(secret ?? '').trim();
  if (value.length < 8 || value.length > 400 || /\s/.test(value)) throw new KeyError('Clé invalide : 8 à 400 caractères, sans espace.');
  const hash = fingerprint(value);
  if ((await query('SELECT 1 FROM api_keys WHERE secret_hash = $1', [hash])).length) throw new KeyError('Cette clé existe déjà.');
  const rows = await query(
    `INSERT INTO api_keys (provider, label, secret_enc, secret_hash, last4, owner, origin, created_by, assigned_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END)
     RETURNING ${COLUMNS}`,
    [provider, String(label).slice(0, 60), seal(value, env), hash, last4(value), owner, createdBy],
  );
  return view(rows[0]);
}

export async function listKeys({ owner } = {}) {
  const rows = owner === undefined
    ? await query(`SELECT ${COLUMNS} FROM api_keys ORDER BY owner NULLS FIRST, id`)
    : await query(`SELECT ${COLUMNS} FROM api_keys WHERE owner = $1 ORDER BY id`, [owner]);
  return rows.map(view);
}

// Attribue une clé à un utilisateur ; owner = null la remet dans le pool partagé.
export async function assignKey(id, owner) {
  const rows = await query(
    `UPDATE api_keys SET owner = $2, origin = 'admin', assigned_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END, exhausted_on = NULL
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, owner],
  );
  if (!rows.length) throw new KeyError('Clé introuvable.');
  return view(rows[0]);
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
// retirent la clé fautive, used() retient laquelle a servi (journal d'usage).
export async function keySourceFor(username, env = process.env) {
  const [{ n: owned }] = await query('SELECT count(*)::int AS n FROM api_keys WHERE owner = $1', [username]);
  const own = owned > 0;
  const rows = own
    ? await query('SELECT id, provider, secret_enc, exhausted_on FROM api_keys WHERE owner = $1 AND disabled = false ORDER BY id', [username])
    : await query('SELECT id, provider, secret_enc, exhausted_on FROM api_keys WHERE owner IS NULL AND disabled = false ORDER BY id');

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
  // Pool partagé vide (aucune clé enregistrée) : les clés d'environnement servent de secours (développement, démarrage).
  let fromEnv = false;
  if (!own && !(await query('SELECT 1 FROM api_keys WHERE owner IS NULL LIMIT 1')).length) {
    for (const p of PROVIDERS) for (const k of keysFor(p.name, env)) list.push({ id: null, provider: p.name, secret: k });
    fromEnv = true;
  }
  list.sort((a, b) => rank(a.provider) - rank(b.provider));

  const providerOf = (name) => resolveProvider(PROVIDERS.find((p) => p.name === name), env);
  return {
    mode: own ? 'own' : fromEnv ? 'env' : 'pool',
    lastUsedId: null,
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
    used(entry) {
      this.lastUsedId = entry.id;
    },
    secrets: () => list.map((k) => k.secret), // pour masquer toute fuite dans les journaux et les réponses
  };
}

export async function logUsage(username, keyId, kind, ok) {
  await query('INSERT INTO ai_usage (username, key_id, kind, ok) VALUES ($1, $2, $3, $4)', [username, keyId, kind, ok]).catch(() => {});
}
