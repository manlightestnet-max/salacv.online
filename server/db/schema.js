// Schéma Postgres (Neon en production, PGlite en local et en test). Chaque instruction est
// idempotente (IF NOT EXISTS) : elles tournent au premier accès de chaque instance, sans verrou,
// et une instruction par appel (le pilote HTTP de Neon n'en accepte qu'une).
export const SCHEMA_VERSION = 1;

export const STATEMENTS = [
  // Stockage clé/valeur (modèles, skills, ressources, journal…) et listes bornées (CV d'essai, journal).
  `CREATE TABLE IF NOT EXISTS kv (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS kv_list (
    id bigserial PRIMARY KEY,
    key text NOT NULL,
    value jsonb NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS kv_list_key_idx ON kv_list (key, id DESC)`,

  // Réglages de l'admin. secret = chiffré avec SALACV_MASTER_KEY, jamais renvoyé en clair.
  `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    secret boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Comptes : un utilisateur = une adresse Google (ou « key:<id> » pour une clé en ligne).
  `CREATE TABLE IF NOT EXISTS users (
    username text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    first_at timestamptz NOT NULL DEFAULT now(),
    last_at timestamptz NOT NULL DEFAULT now(),
    logins integer NOT NULL DEFAULT 0,
    blocked boolean NOT NULL DEFAULT false,
    reason text NOT NULL DEFAULT '',
    ai_access boolean NOT NULL DEFAULT true
  )`,

  // Pool de clés des fournisseurs IA. owner NULL = pool partagé de l'admin ; sinon la clé n'appartient
  // qu'à cet utilisateur (ajoutée par lui, origin 'user', ou attribuée par l'admin, origin 'admin').
  `CREATE TABLE IF NOT EXISTS api_keys (
    id bigserial PRIMARY KEY,
    provider text NOT NULL,
    label text NOT NULL DEFAULT '',
    secret_enc text NOT NULL,
    secret_hash text NOT NULL UNIQUE,
    last4 text NOT NULL,
    owner text,
    origin text NOT NULL DEFAULT 'admin',
    disabled boolean NOT NULL DEFAULT false,
    disabled_reason text NOT NULL DEFAULT '',
    exhausted_on date,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    assigned_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS api_keys_owner_idx ON api_keys (owner)`,

  // Journal d'usage de l'IA : sert plus tard aux quotas (rien n'est encore plafonné).
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id bigserial PRIMARY KEY,
    username text NOT NULL,
    key_id bigint,
    kind text NOT NULL,
    ok boolean NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage (username, at DESC)`,
];
