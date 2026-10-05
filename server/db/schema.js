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

  // Clés « public » : les seules que les visiteurs non connectés peuvent utiliser (voir server/quota.js).
  `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false`,

  // Consommation d'IA des visiteurs non connectés : une ligne par session (sid:…) et par IP (ip:…), jamais remise à zéro.
  `CREATE TABLE IF NOT EXISTS anon_usage (
    subject text PRIMARY KEY,
    tokens bigint NOT NULL DEFAULT 0,
    first_at timestamptz NOT NULL DEFAULT now(),
    last_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Crédits : solde par compte + registre de toutes les opérations (cadeau, achat, génération). Le solde ne
  // se modifie que par des instructions atomiques : jamais « lire puis réécrire ».
  `CREATE TABLE IF NOT EXISTS credits (
    username text PRIMARY KEY,
    balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS credit_ledger (
    id bigserial PRIMARY KEY,
    username text NOT NULL,
    delta integer NOT NULL,
    balance_after integer NOT NULL,
    reason text NOT NULL,
    ref text UNIQUE,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (username, id DESC)`,

  // Versions de CV déjà générées proprement par un compte (empreinte) : les retélécharger ne coûte rien.
  `CREATE TABLE IF NOT EXISTS renders (
    username text NOT NULL,
    fingerprint text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (username, fingerprint)
  )`,
  // Compteur public des CV générés (statistiques de la landing) : une ligne par génération, sans donnée personnelle.
  `CREATE TABLE IF NOT EXISTS render_log (
    id bigserial PRIMARY KEY,
    clean boolean NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,

  // Avis (note + mot) de n'importe quel utilisateur ; un seul par personne (compte, sinon session), modifiable.
  `CREATE TABLE IF NOT EXISTS feedback (
    id bigserial PRIMARY KEY,
    subject text NOT NULL UNIQUE,
    stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment text NOT NULL DEFAULT '',
    ip_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS feedback_ip_idx ON feedback (ip_hash, updated_at DESC)`,

  // CV (et « personnalités ») des comptes connectés. Le contenu va sur R2 quand il est configuré (r2_key), sinon
  // dans la base (data) : l'application marche dans les deux cas.
  `CREATE TABLE IF NOT EXISTS projects (
    username text NOT NULL,
    id text NOT NULL,
    kind text NOT NULL DEFAULT 'cv',
    data jsonb,
    r2_key text,
    bytes integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (username, id)
  )`,

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
  `ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS tokens integer NOT NULL DEFAULT 0`,
  // Photo du compte Google (adresse https de Google), affichée dans « Mon compte ».
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS picture text NOT NULL DEFAULT ''`,
];
