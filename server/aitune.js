// Réglages de l'agent, pilotés depuis l'admin (Admin → IA) : combien d'étapes par demande, combien d'historique,
// plafond de tokens par demande, nombre de skills chargées. Et ce que coûte l'IA, comparé à ce que rapportent les crédits.
import { query } from './db/index.js';
import { getSetting, getNumberSetting } from './settings.js';
import { PROVIDERS } from './agent/llm/providers.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** → { maxSteps, historySent, maxTokensPerRequest (0 = sans plafond), maxSkills } */
export async function agentTuning(env = process.env) {
  return {
    maxSteps: clamp(await getNumberSetting('ai.maxSteps', env), 1, 12),
    historySent: clamp(await getNumberSetting('ai.historySent', env), 0, 12),
    maxTokensPerRequest: await getNumberSetting('ai.maxTokensPerRequest', env),
    maxSkills: clamp(await getNumberSetting('ai.maxSkills', env), 0, 5),
  };
}

/** Prix saisi par l'admin : FCFA pour un million de tokens, par fournisseur. */
export async function prices(env = process.env) {
  const out = {};
  for (const p of PROVIDERS) out[p.name] = await getNumberSetting(`ai.price.${p.name}`, env);
  return out;
}

const fcfa = (tokens, price) => Math.round((Number(tokens) * Number(price || 0)) / 1_000_000);

/**
 * Coûts : aujourd'hui et sur 30 jours, par fournisseur et par usage (assistant, traduction, import…), en tokens et en
 * FCFA (prix saisis) ; face à l'argent encaissé par les crédits (réel, 30 jours). Alerte si le jour dépasse le seuil.
 */
export async function aiCosts(env = process.env) {
  const price = await prices(env);
  const rows = await query(
    `SELECT COALESCE(provider, 'inconnu') AS provider, kind,
       COALESCE(SUM(tokens) FILTER (WHERE at >= date_trunc('day', now())), 0)::bigint AS today,
       COALESCE(SUM(tokens), 0)::bigint AS month,
       COUNT(*)::int AS requests
     FROM ai_usage WHERE at >= now() - interval '30 days' GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const lines = rows.map((r) => ({
    provider: r.provider,
    kind: r.kind,
    requests: r.requests,
    today: Number(r.today),
    month: Number(r.month),
    costToday: fcfa(r.today, price[r.provider]),
    costMonth: fcfa(r.month, price[r.provider]),
  }));
  const sum = (k) => lines.reduce((a, l) => a + l[k], 0);
  const [rev] = await query(
    `SELECT COALESCE(SUM(amount), 0)::int AS revenue FROM credit_orders WHERE status = 'PAID' AND env = 'production' AND paid_at >= now() - interval '30 days'`,
  ).catch(() => [{ revenue: 0 }]);
  const alert = await getNumberSetting('ai.alertDailyFcfa', env);
  const costToday = sum('costToday');
  return {
    lines,
    tokensToday: sum('today'),
    tokensMonth: sum('month'),
    costToday,
    costMonth: sum('costMonth'),
    revenueMonth: rev?.revenue ?? 0,
    alert,
    alerting: alert > 0 && costToday >= alert,
    priced: Object.values(price).some((p) => p > 0),
    resetCost: await getSetting('ai.resetCost', env),
  };
}
