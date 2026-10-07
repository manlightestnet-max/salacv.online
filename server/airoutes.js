// Routes de l'IA du compte : sa réserve et les packs en vente, la remise à zéro, l'achat d'un pack (en crédits).
import { verify } from './agent/auth.js';
import { getUser } from './db/users.js';
import * as credits from './credits.js';
import { buyAiPack, buyReset, listAiPacks, publicUserQuota, resetCost, userQuota } from './aiquota.js';

const userOf = async (token, env) => {
  const username = token ? verify(token, env) : null;
  if (!username) return null;
  const user = await getUser(username).catch(() => null);
  return user?.blocked ? null : username;
};

export async function aiQuotaRoute(token, { env = process.env } = {}) {
  const username = await userOf(token, env);
  if (!username) return [401, { ok: false, error: 'Connecte-toi pour voir ton IA.' }];
  return [
    200,
    {
      ok: true,
      quota: publicUserQuota(await userQuota(username, env)),
      resetCost: await resetCost(env),
      balance: await credits.balance(username),
      packs: (await listAiPacks()).filter((p) => p.active).map(({ id, name, tokens, credits: c, days }) => ({ id, name, tokens, credits: c, days })),
    },
  ];
}

export async function aiResetRoute(token, { env = process.env } = {}) {
  const username = await userOf(token, env);
  if (!username) return [401, { ok: false, error: 'Connecte-toi pour remettre ton IA à zéro.' }];
  const r = await buyReset(username, env);
  return [r.ok ? 200 : 402, r];
}

export async function aiBuyRoute(payload, token, { env = process.env } = {}) {
  const username = await userOf(token, env);
  if (!username) return [401, { ok: false, error: 'Connecte-toi pour acheter un pack IA.' }];
  const r = await buyAiPack(username, payload?.packId, env);
  return [r.ok ? 200 : r.code === 'NO_CREDIT' ? 402 : 404, r];
}
