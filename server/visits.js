// Visiteurs du site (Admin → Visiteurs) : qui vient, d'où, sur quel appareil, combien de temps, sur quelles pages.
//
//   • Aucun service tiers, rien dans le navigateur : le visiteur est reconnu par le cookie anonyme signé qui existe déjà
//     (sv_anon, voir identity.js) ; un compte connecté est noté en plus.
//   • L'adresse IP n'est JAMAIS gardée en entier : masquée dès l'arrivée (IPv4 : 3 premiers octets ; IPv6 : préfixe).
//   • Pays et ville : en-têtes posés par Vercel (x-vercel-ip-*) ou Cloudflare (cf-ipcountry). Rien en local.
//   • Appareil, système, navigateur : lus dans le user-agent. Les robots (Google, aperçus WhatsApp…) sont ignorés.
//   • Une visite = un même navigateur sans pause de plus de 30 minutes. Durée = dernier signe de vie − arrivée ;
//     la page envoie un signe de vie toutes les 20 s tant qu'elle est visible.
//   • Les visites de plus de 90 jours sont effacées.
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { query } from './db/index.js';

const GAP_MINUTES = 30;
const KEEP_DAYS = 90;
const MAX_PATHS = 30;

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discord|skype|curl|wget|python|node-fetch|axios|go-http|java\/|vercel|uptime|monitor/i;
export const isBot = (ua) => !ua || BOT.test(ua);

/** IP masquée : 41.202.17.• ; IPv6 : 2c0f:f8f0:1a2b::• (déjà réduite au /64 par identity.js). */
export function maskIp(ip) {
  const s = String(ip ?? '');
  if (net.isIPv4(s)) return `${s.split('.').slice(0, 3).join('.')}.•`;
  const v6 = s.replace(/::\/64$/, '');
  if (/^[0-9a-f:]+$/i.test(v6) && v6.includes(':')) return `${v6.split(':').slice(0, 3).join(':')}::•`;
  return 'inconnue';
}

/** { type: mobile | tablette | ordinateur | app PC, os, browser } d'après le user-agent. */
export function device(ua = '', client = 'web') {
  const u = String(ua);
  const tablet = /iPad|Tablet|PlayBook|Silk|Kindle/i.test(u) || (/Android/i.test(u) && !/Mobile/i.test(u));
  const mobile = !tablet && /Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(u);
  const type = client === 'desktop' || /Electron/i.test(u) ? 'app PC' : tablet ? 'tablette' : mobile ? 'mobile' : 'ordinateur';
  const os = /Android/i.test(u) ? 'Android' : /iPhone|iPad|iPod/i.test(u) ? 'iOS' : /Windows/i.test(u) ? 'Windows' : /CrOS/i.test(u) ? 'ChromeOS' : /Mac OS X|Macintosh/i.test(u) ? 'macOS' : /Linux/i.test(u) ? 'Linux' : 'Autre';
  const browser = /SamsungBrowser/i.test(u)
    ? 'Samsung Internet'
    : /OPR\/|Opera|OPiOS/i.test(u)
      ? 'Opera'
      : /Edg(e|A|iOS)?\//i.test(u)
        ? 'Edge'
        : /Firefox|FxiOS/i.test(u)
          ? 'Firefox'
          : /CriOS|Chrome\//i.test(u)
            ? 'Chrome'
            : /Safari/i.test(u)
              ? 'Safari'
              : 'Autre';
  return { type, os, browser };
}

/** Pays (code ISO à 2 lettres) et ville, d'après les en-têtes de l'hébergeur. */
export function geo(headers = {}) {
  const raw = (k) => String(headers[k] ?? '').trim();
  const country = (raw('x-vercel-ip-country') || raw('cf-ipcountry')).toUpperCase();
  let city = raw('x-vercel-ip-city');
  try {
    city = decodeURIComponent(city);
  } catch {}
  return { country: /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : '', city: city.slice(0, 60) };
}

// Chemin seul (jamais la requête : un ?p= désigne un CV privé), borné.
const cleanPath = (p) => {
  const s = String(p ?? '').split(/[?#]/)[0].slice(0, 80);
  return /^\/[\w\-./]*$/.test(s) ? s : '/';
};
// Source : domaine du site d'où il vient (google.com, facebook.com…), ou utm_source ; jamais l'adresse complète.
const cleanSource = (s) => String(s ?? '').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.\-_]/g, '').slice(0, 60);

/**
 * Un signe du navigateur. payload : { type: view | ping | leave, path, source }.
 * req : la requête (en-têtes) ; ctx : { ip, sid, client } (identity.js) ; username : compte connecté ou null.
 */
export async function track(payload, req, ctx, username = null) {
  const ua = String(req.headers?.['user-agent'] ?? '');
  if (isBot(ua) || !ctx?.sid) return { ok: true, skipped: true };
  const type = ['view', 'ping', 'leave'].includes(payload?.type) ? payload.type : null;
  if (!type) return { ok: false, error: 'Signe inconnu.' };
  const visitor = `sid:${ctx.sid}`;
  const [current] = await query(`SELECT id FROM visits WHERE visitor = $1 AND last_seen > now() - interval '${GAP_MINUTES} minutes' ORDER BY last_seen DESC LIMIT 1`, [visitor]);

  if (type !== 'view') {
    if (current) await query(`UPDATE visits SET last_seen = now(), ended_at = ${type === 'leave' ? 'now()' : 'NULL'}, username = COALESCE(username, $2) WHERE id = $1`, [current.id, username]);
    return { ok: true };
  }

  const path = cleanPath(payload.path);
  if (current) {
    await query(
      `UPDATE visits SET last_seen = now(), ended_at = NULL, pages = pages + 1, last_path = $2, username = COALESCE(username, $3),
         paths = CASE WHEN cardinality(paths) < ${MAX_PATHS} THEN array_append(paths, $2) ELSE paths END
       WHERE id = $1`,
      [current.id, path, username],
    );
    return { ok: true };
  }
  const { type: kind, os, browser } = device(ua, ctx.client);
  const { country, city } = geo(req.headers);
  // Jamais vu avant ? (un visiteur qui revient garde son cookie)
  const [seen] = await query('SELECT 1 FROM visits WHERE visitor = $1 LIMIT 1', [visitor]);
  await query(
    `INSERT INTO visits (id, visitor, username, ip_masked, country, city, device, os, browser, source, landing, last_path, paths, came_back)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, ARRAY[$11]::text[], $12)`,
    [randomBytes(9).toString('base64url'), visitor, username, maskIp(ctx.ip), country, city, kind, os, browser, cleanSource(payload.source), path, Boolean(seen)],
  );
  if (Math.random() < 0.02) query(`DELETE FROM visits WHERE started_at < now() - interval '${KEEP_DAYS} days'`).catch(() => {});
  return { ok: true };
}

// --- Admin ----------------------------------------------------------------------------------------

const RANGES = { today: "date_trunc('day', now())", '7d': "now() - interval '7 days'", '30d': "now() - interval '30 days'" };

/** Tableau de bord des visiteurs sur une période (today | 7d | 30d). */
export async function visitStats(range = 'today') {
  const since = RANGES[range] ?? RANGES.today;
  const W = `WHERE started_at >= ${since}`;
  const [totals] = await query(
    `SELECT COUNT(DISTINCT visitor)::int AS visitors, COUNT(*)::int AS visits,
       COUNT(DISTINCT visitor) FILTER (WHERE NOT came_back)::int AS new_visitors,
       COALESCE(SUM(pages), 0)::int AS pages,
       COALESCE(AVG(EXTRACT(EPOCH FROM last_seen - started_at)), 0)::int AS avg_seconds,
       COUNT(*) FILTER (WHERE pages = 1 AND last_seen - started_at < interval '10 seconds')::int AS bounces,
       COUNT(DISTINCT visitor) FILTER (WHERE username IS NOT NULL)::int AS logged
     FROM visits ${W}`,
  );
  const [online] = await query(`SELECT COUNT(DISTINCT visitor)::int AS n FROM visits WHERE last_seen > now() - interval '2 minutes' AND ended_at IS NULL`);
  const group = (col, limit = 8) =>
    query(`SELECT COALESCE(NULLIF(${col}, ''), '?') AS k, COUNT(DISTINCT visitor)::int AS n FROM visits ${W} GROUP BY 1 ORDER BY n DESC, k LIMIT ${limit}`);
  const pages = await query(`SELECT p AS k, COUNT(*)::int AS n FROM visits, unnest(paths) AS p ${W} GROUP BY p ORDER BY n DESC, p LIMIT 10`);
  const days = await query(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS d, COUNT(DISTINCT visitor)::int AS n
     FROM visits WHERE started_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`,
  );
  const recent = await query(
    `SELECT id, username, ip_masked, country, city, device, os, browser, source, landing, last_path, pages, came_back, started_at, last_seen, ended_at
     FROM visits ${W} ORDER BY last_seen DESC LIMIT 60`,
  );
  const now = Date.now();
  return {
    range,
    totals: { ...totals, online: online?.n ?? 0 },
    countries: await group('country', 12),
    devices: await group('device'),
    os: await group('os'),
    browsers: await group('browser'),
    sources: await group('source'),
    pages,
    days,
    recent: recent.map((r) => {
      const last = new Date(r.last_seen).getTime();
      return {
        id: r.id,
        username: r.username,
        ip: r.ip_masked,
        country: r.country,
        city: r.city,
        device: r.device,
        os: r.os,
        browser: r.browser,
        source: r.source,
        landing: r.landing,
        lastPath: r.last_path,
        pages: r.pages,
        returning: r.came_back,
        startedAt: new Date(r.started_at).getTime(),
        lastSeen: last,
        seconds: Math.max(0, Math.round((last - new Date(r.started_at).getTime()) / 1000)),
        online: !r.ended_at && now - last < 2 * 60_000,
      };
    }),
  };
}
