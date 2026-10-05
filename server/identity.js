// Qui est-ce ? Un visiteur non connecté est reconnu par deux choses que lui-même ne contrôle pas :
//   • son adresse IP (vue par le serveur) — résiste à l'effacement du navigateur ;
//   • un cookie signé (httpOnly) — distingue deux personnes derrière la même IP.
// Rien n'est lu dans le localStorage : l'effacer ne remet aucun compteur à zéro.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { signingSecret } from './agent/auth.js';

export const ANON_COOKIE = 'sv_anon';
const YEAR = 365 * 24 * 3600;

// IPv4 telle quelle ; IPv6 réduite à son préfixe /64 (une personne dispose de milliards d'adresses dans un /64 :
// sans cela, changer d'adresse suffirait à repartir de zéro). ::ffff:a.b.c.d (IPv4 mappée) redevient a.b.c.d.
export function normalizeIp(raw) {
  let ip = String(raw ?? '').trim();
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return 'inconnue';
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':')}::/64`;
}

// Derrière Vercel (ou un proxy de confiance) : x-real-ip / premier élément de x-forwarded-for.
export function clientIp(req) {
  const h = req.headers ?? {};
  const forwarded = String(h['x-forwarded-for'] ?? '').split(',')[0].trim();
  // premier candidat non vide : en-tête du proxy, sinon adresse de la connexion elle-même
  return normalizeIp([String(h['x-real-ip'] ?? '').trim(), forwarded, req.socket?.remoteAddress].find(Boolean));
}

const sign = (id, env) => createHmac('sha256', signingSecret(env)).update(`anon:${id}`).digest('base64url');

export const SESSION_COOKIE = 'sv_session';
export const ADMIN_COOKIE = 'sv_admin';

// Cookie de session : httpOnly (invisible du JavaScript de la page), Secure en ligne, SameSite=Lax (jamais envoyé par un autre site).
export function cookieString(name, value, maxAge, req, env = process.env) {
  const secure = String(req?.headers?.['x-forwarded-proto'] ?? '').includes('https') || Boolean(env.VERCEL);
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export const clearCookieString = (name, req, env) => cookieString(name, '', 0, req, env);
export const readCookie = (req, name) => parseCookies(req.headers?.cookie)[name] ?? '';

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Cookie valide → son identifiant ; absent ou falsifié → nouvel identifiant (à poser avec setCookie).
export function anonSession(req, env = process.env) {
  const raw = parseCookies(req.headers?.cookie)[ANON_COOKIE] ?? '';
  const [id, sig] = raw.split('.');
  const key = signingSecret(env);
  if (key && id && sig) {
    const expected = Buffer.from(sign(id, env));
    const given = Buffer.from(sig);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return { sid: id, setCookie: null };
  }
  const sid = randomBytes(12).toString('hex');
  if (!key) return { sid, setCookie: null };
  const secure = String(req.headers?.['x-forwarded-proto'] ?? '').includes('https') || Boolean(env.VERCEL);
  return { sid, setCookie: `${ANON_COOKIE}=${sid}.${sign(sid, env)}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}` };
}

// Contexte d'une requête : IP, identifiant de session anonyme, type de client (l'app desktop se déclare).
export function context(req, env = process.env) {
  const { sid, setCookie } = anonSession(req, env);
  return { ip: clientIp(req), sid, setCookie, client: req.headers?.['x-salacv-client'] === 'desktop' ? 'desktop' : 'web' };
}
