// Quota d'IA du visiteur non connecté : 250 000 tokens, UNE SEULE FOIS (jamais remis à zéro), par session
// ET par adresse IP — on bloque dès que l'un des deux est atteint. Compté côté serveur, en base : effacer
// le navigateur (localStorage, cookies) ne rend rien. Les plafonds se règlent dans l'admin.
import { query } from './db/index.js';
import { getNumberSetting } from './settings.js';

export async function limits(env = process.env) {
  return { session: await getNumberSetting('quota.anonTokens', env), ip: await getNumberSetting('quota.ipTokens', env) };
}

const subjects = (ctx) => [`sid:${ctx.sid}`, `ip:${ctx.ip}`];

export async function anonUsage(ctx, env = process.env) {
  const rows = await query('SELECT subject, tokens FROM anon_usage WHERE subject = ANY($1)', [subjects(ctx)]);
  const by = Object.fromEntries(rows.map((r) => [r.subject, Number(r.tokens)]));
  const lim = await limits(env);
  const session = by[`sid:${ctx.sid}`] ?? 0;
  const ip = by[`ip:${ctx.ip}`] ?? 0;
  // percent : la contrainte la plus serrée des deux (pour la barre de progression)
  const percent = Math.min(100, Math.round(Math.max(lim.session ? (session / lim.session) * 100 : 100, lim.ip ? (ip / lim.ip) * 100 : 100)));
  return { session, ip, limitSession: lim.session, limitIp: lim.ip, percent, exhausted: session >= lim.session || ip >= lim.ip, remaining: Math.max(0, Math.min(lim.session - session, lim.ip - ip)) };
}

// tokens consommés par une requête (réponse du fournisseur, ou estimation) : ajoutés à la session ET à l'IP.
export async function addAnonUsage(ctx, tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0));
  if (!n) return;
  for (const subject of subjects(ctx)) {
    await query(
      'INSERT INTO anon_usage (subject, tokens) VALUES ($1, $2) ON CONFLICT (subject) DO UPDATE SET tokens = anon_usage.tokens + EXCLUDED.tokens, last_at = now()',
      [subject, n],
    );
  }
}
