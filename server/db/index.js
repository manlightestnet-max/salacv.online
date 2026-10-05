// Accès à la base : Neon en production (DATABASE_URL), PGlite (vrai Postgres, en local) sinon.
//
//   await query('SELECT … WHERE a = $1', [valeur])  →  tableau de lignes
//
// Neon passe par HTTP (adapté aux fonctions Vercel, sans connexion persistante). PGlite sert au
// développement (dossier SALACV_DATA_DIR/pg) et aux tests (mémoire). Aucun mot de passe n'est lu
// ailleurs que dans DATABASE_URL, qui reste une variable d'environnement.
import path from 'node:path';
import { STATEMENTS } from './schema.js';

let current = null;
let opening = null;

async function migrate(conn) {
  for (const statement of STATEMENTS) await conn.query(statement);
}

async function openNeon(url) {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return { kind: 'neon', query: async (text, params = []) => sql.query(text, params) };
}

async function openLocal(dir) {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('Base absente : définis DATABASE_URL (Neon), ou installe les dépendances de développement (PGlite).');
  }
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return { kind: dir ? 'pglite' : 'memory', query: async (text, params = []) => (await pg.query(text, params)).rows };
}

export async function db(env = process.env) {
  if (current) return current;
  opening ??= (async () => {
    const conn = env.DATABASE_URL ? await openNeon(env.DATABASE_URL) : await openLocal(env.SALACV_DB === 'memory' ? null : path.resolve(env.SALACV_DATA_DIR || 'data', 'pg'));
    await migrate(conn);
    current = conn;
    return conn;
  })().finally(() => (opening = null));
  return opening;
}

export const query = async (text, params) => (await db()).query(text, params);

// Tests : une base PGlite en mémoire, vide, avec le schéma.
export async function memoryDb() {
  const conn = await openLocal(null);
  await migrate(conn);
  current = conn;
  return conn;
}
