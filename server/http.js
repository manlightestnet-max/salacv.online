// Adaptateur HTTP commun : le même code sert les fonctions Vercel (api/*.js) et le serveur
// Node du VPS (server/index.js). Vercel = VPS : aucune différence de comportement.
import * as web from './agent/web.js';

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(data);
}

// Corps JSON : déjà lu par Vercel (req.body), à lire soi-même sur un serveur Node nu.
async function readJson(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > web.MAX_BODY) throw Object.assign(new Error('trop grand'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();

export const ROUTES = {
  login: (payload, req) => web.login(payload, clientIp(req)),
  agent: (payload, req) => web.agent(payload, web.bearer(req.headers.authorization)),
};

export async function serve(name, req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Méthode non autorisée.' });
  let payload;
  try {
    payload = await readJson(req);
  } catch (err) {
    return send(res, err.status ?? 400, { ok: false, error: err.status === 413 ? 'Requête trop grande.' : 'JSON invalide.' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > web.MAX_BODY) {
    return send(res, 400, { ok: false, error: 'Requête invalide.' });
  }
  try {
    const [status, body] = await ROUTES[name](payload, req);
    send(res, status, body);
  } catch (err) {
    console.error(`[api/${name}] ${err.name}`);
    send(res, 500, { ok: false, error: 'Erreur interne.' });
  }
}
