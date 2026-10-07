// IA des comptes connectés : une réserve de tokens (réglée dans l'admin), sans recharge automatique.
// Elle se vide à chaque échange avec l'assistant ; pour la remplir : la remettre à zéro (prix en crédits,
// 0,5 par défaut) ou acheter un pack IA (packs créés par l'admin, aucun au départ). L'admin peut aussi
// remettre un compte à zéro, lui fixer un plafond à part ou lui offrir des tokens.
//
//   reste = plafond (réglage, ou plafond du compte) + tokens des packs encore valides − tokens utilisés
import crypto from 'node:crypto';
import { query } from './db/index.js';
import { getSetting, getNumberSetting } from './settings.js';
import { store } from './store.js';
import * as credits from './credits.js';

export const DEFAULT_USER_TOKENS = 200_000;

export async function resetCost(env = process.env) {
  const v = Number(String(await getSetting('ai.resetCost', env)).replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : 0.5;
}

async function row(username) {
  const [r] = await query('SELECT used, custom_limit FROM ai_allowance WHERE username = $1', [username]);
  return r ?? { used: 0, custom_limit: null };
}

const bonusOf = async (username) =>
  Number(
    (await query('SELECT COALESCE(SUM(tokens), 0) AS n FROM ai_grants WHERE username = $1 AND (expires_at IS NULL OR expires_at > now())', [username]))[0].n,
  );

/** Où en est l'IA de ce compte. percent : part de la réserve déjà utilisée (0 → 100). */
export async function userQuota(username, env = process.env) {
  const r = await row(username);
  const base = r.custom_limit != null ? Number(r.custom_limit) : await getNumberSetting('ai.userTokens', env);
  const limit = base + (await bonusOf(username));
  const used = Number(r.used);
  const remaining = Math.max(0, limit - used);
  return { limit, used, remaining, percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100, exhausted: remaining <= 0, custom: r.custom_limit != null };
}

/** Ce que le navigateur peut savoir (rien d'autre que sa propre réserve). */
export const publicUserQuota = (q) => ({ percent: q.percent, remaining: q.remaining, limit: q.limit, exhausted: q.exhausted, account: true });

export async function addUserUsage(username, tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0));
  if (!n) return;
  await query(
    `INSERT INTO ai_allowance (username, used) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET used = ai_allowance.used + EXCLUDED.used, updated_at = now()`,
    [username, n],
  );
}

const clearUsage = (username) =>
  query(`INSERT INTO ai_allowance (username, used) VALUES ($1, 0) ON CONFLICT (username) DO UPDATE SET used = 0, updated_at = now()`, [username]);

// --- Packs IA (créés par l'admin) ------------------------------------------------------------------
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;
export const listAiPacks = async () => (await store().get('aiPacks', [])) ?? [];

export function checkAiPacks(input) {
  if (!Array.isArray(input) || input.length > 12) return { ok: false, error: 'Entre 0 et 12 packs IA.' };
  const seen = new Set();
  const packs = [];
  for (const raw of input) {
    const p = {
      id: String(raw?.id ?? '').trim(),
      name: String(raw?.name ?? '').trim().slice(0, 40),
      tokens: Number(raw?.tokens),
      credits: Number(String(raw?.credits ?? '').replace(',', '.')),
      days: raw?.days === '' || raw?.days == null ? null : Number(raw.days),
      active: raw?.active !== false,
    };
    if (!PACK_ID.test(p.id) || seen.has(p.id)) return { ok: false, error: `Identifiant de pack IA invalide ou en double : « ${p.id} ».` };
    if (!p.name) return { ok: false, error: 'Chaque pack IA a un nom.' };
    if (!Number.isInteger(p.tokens) || p.tokens < 1000 || p.tokens > 100_000_000) return { ok: false, error: `${p.name} : entre 1 000 et 100 000 000 tokens.` };
    if (!Number.isFinite(p.credits) || p.credits < 0.5 || p.credits > 1000 || Math.round(p.credits * 10) !== p.credits * 10) return { ok: false, error: `${p.name} : prix en crédits (0,5 minimum, une décimale).` };
    if (p.days !== null && (!Number.isInteger(p.days) || p.days < 1 || p.days > 366)) return { ok: false, error: `${p.name} : durée entre 1 et 366 jours, ou vide (sans limite).` };
    seen.add(p.id);
    packs.push(p);
  }
  return { ok: true, packs };
}

export const saveAiPacks = (packs) => store().set('aiPacks', packs);

// --- Actions du compte ---------------------------------------------------------------------------
/** Remet la réserve à zéro (pleine) contre `resetCost` crédits. → { ok, balance, quota } | { ok:false, code:'NO_CREDIT' } */
export async function buyReset(username, env = process.env) {
  const cost = await resetCost(env);
  if (cost > 0) {
    const r = await credits.spend(username, cost, 'IA remise à zéro', `aireset:${username}:${crypto.randomUUID()}`);
    if (!r.ok) return { ok: false, code: 'NO_CREDIT', error: `Il te faut ${String(cost).replace('.', ',')} crédit pour remettre l’IA à zéro.`, balance: r.balance };
  }
  await clearUsage(username);
  return { ok: true, balance: await credits.balance(username), quota: publicUserQuota(await userQuota(username, env)) };
}

/** Achète un pack IA avec des crédits : ses tokens s'ajoutent à la réserve (pour `days` jours si limité). */
export async function buyAiPack(username, packId, env = process.env) {
  const pack = (await listAiPacks()).find((p) => p.id === String(packId ?? '') && p.active);
  if (!pack) return { ok: false, error: 'Ce pack IA n’est plus disponible.' };
  const ref = `aipack:${username}:${crypto.randomUUID()}`;
  const r = await credits.spend(username, pack.credits, `Pack IA · ${pack.name}`, ref);
  if (!r.ok) return { ok: false, code: 'NO_CREDIT', error: `Il te faut ${String(pack.credits).replace('.', ',')} crédit${pack.credits > 1 ? 's' : ''} pour ${pack.name}.`, balance: r.balance };
  await query(
    `INSERT INTO ai_grants (username, tokens, reason, ref, expires_at) VALUES ($1, $2, $3, $4, ${pack.days ? `now() + interval '${pack.days} days'` : 'NULL'})`,
    [username, pack.tokens, `Pack IA · ${pack.name}`, ref],
  );
  return { ok: true, balance: await credits.balance(username), quota: publicUserQuota(await userQuota(username, env)) };
}

// --- Admin : un compte à part ------------------------------------------------------------------------
export async function adminSetAi(username, { reset = false, customLimit, addTokens } = {}) {
  if (reset) await clearUsage(username);
  if (customLimit !== undefined) {
    const v = customLimit === null || customLimit === '' ? null : Number(customLimit);
    if (v !== null && (!Number.isInteger(v) || v < 0)) return { ok: false, error: 'Plafond : un nombre de tokens (0 ou plus), ou vide pour le réglage général.' };
    await query(
      `INSERT INTO ai_allowance (username, custom_limit) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET custom_limit = EXCLUDED.custom_limit, updated_at = now()`,
      [username, v],
    );
  }
  if (addTokens) {
    const n = Number(addTokens);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Tokens offerts : un nombre entier positif.' };
    await query('INSERT INTO ai_grants (username, tokens, reason, ref) VALUES ($1, $2, $3, $4)', [username, n, 'Offert par salacv', `aigift:${crypto.randomUUID()}`]);
  }
  return { ok: true };
}

/** Réserve de tous les comptes (liste de l'admin). */
export async function allowances(env = process.env) {
  const base = await getNumberSetting('ai.userTokens', env);
  const rows = await query(
    `SELECT a.username, a.used, a.custom_limit,
       (SELECT COALESCE(SUM(g.tokens), 0) FROM ai_grants g WHERE g.username = a.username AND (g.expires_at IS NULL OR g.expires_at > now())) AS bonus
     FROM ai_allowance a`,
  );
  return Object.fromEntries(rows.map((r) => [r.username, { used: Number(r.used), limit: (r.custom_limit != null ? Number(r.custom_limit) : base) + Number(r.bonus), custom: r.custom_limit != null ? Number(r.custom_limit) : null }]));
}
