// Crédits des comptes : tout est côté serveur, en base. Chaque opération est UNE instruction atomique
// (jamais « lire le solde puis le réécrire ») et laisse une ligne dans le registre (credit_ledger).
import { query } from './db/index.js';
import { getNumberSetting } from './settings.js';

// Prix d'une nouvelle version propre (PDF sans filigrane + Word). Re-télécharger la même version est gratuit.
export const PDF_COST = 1;

// Premier passage d'un compte : sa ligne de crédits est créée avec le cadeau d'inscription (une seule fois).
export async function ensureAccount(username, env = process.env) {
  const grant = await getNumberSetting('grant.signupCredits', env);
  const created = await query('INSERT INTO credits (username, balance) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING balance', [username, grant]);
  if (created.length && grant > 0) {
    await query(
      'INSERT INTO credit_ledger (username, delta, balance_after, reason, ref) VALUES ($1, $2, $2, $3, $4) ON CONFLICT (ref) DO NOTHING',
      [username, grant, 'Cadeau d’inscription', `signup:${username}`],
    );
  }
  return balance(username);
}

export async function balance(username) {
  const rows = await query('SELECT balance FROM credits WHERE username = $1', [username]);
  return rows.length ? Number(rows[0].balance) : 0;
}

// Une opération = UNE instruction : le solde ne bouge que si le registre accepte la ligne. ref (unique) rend l'opération
// rejouable sans effet : la rejouer viole l'unicité, l'instruction entière est annulée (solde inclus). Jamais de solde négatif.
async function apply(username, delta, reason, ref) {
  try {
    const rows = await query(
      `WITH s AS (UPDATE credits SET balance = balance + $2 WHERE username = $1 AND balance + $2 >= 0 RETURNING balance)
       INSERT INTO credit_ledger (username, delta, balance_after, reason, ref)
       SELECT $1, $2, balance, $3, $4 FROM s RETURNING balance_after`,
      [username, delta, reason, ref],
    );
    return rows.length ? { ok: true, balance: Number(rows[0].balance_after) } : { ok: false, balance: await balance(username) };
  } catch (err) {
    if (err?.code === '23505') return { ok: false, duplicate: true, balance: await balance(username) }; // déjà appliquée
    throw err;
  }
}

// Débit : seulement si le solde suffit. → { ok: true, balance } | { ok: false, balance }
export const spend = (username, amount, reason, ref) => apply(username, -Math.abs(amount), reason, ref);

// Crédit (achat, geste de l'admin…) ; rejouer la même ref ne crédite pas deux fois. → le solde
export async function add(username, amount, reason, ref) {
  await ensureAccount(username).catch(() => {});
  return (await apply(username, Math.abs(amount), reason, ref)).balance;
}

export async function history(username, n = 20) {
  const rows = await query('SELECT delta, balance_after, reason, at FROM credit_ledger WHERE username = $1 ORDER BY id DESC LIMIT $2', [username, n]);
  return rows.map((r) => ({ delta: Number(r.delta), balance: Number(r.balance_after), reason: r.reason, at: new Date(r.at).getTime() }));
}

// --- Versions déjà générées proprement (re-télécharger = gratuit) ------------------------------
export async function hasRendered(username, fingerprint) {
  return (await query('SELECT 1 FROM renders WHERE username = $1 AND fingerprint = $2', [username, fingerprint])).length > 0;
}

// → vrai si c'est la première fois (l'appelant débite alors un crédit)
export async function markRendered(username, fingerprint) {
  return (await query('INSERT INTO renders (username, fingerprint) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [username, fingerprint])).length > 0;
}

export async function unmarkRendered(username, fingerprint) {
  await query('DELETE FROM renders WHERE username = $1 AND fingerprint = $2', [username, fingerprint]);
}
