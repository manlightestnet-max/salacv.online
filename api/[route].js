// Fonction Vercel UNIQUE pour toutes les routes /api/<nom> (voir server/http.js) : la formule gratuite de
// Vercel limite le nombre de fonctions, et toutes partagent le même code que le serveur du VPS.
import { ROUTES, serve } from '../server/http.js';

export default (req, res) => {
  const name = String(req.query?.route ?? new URL(req.url, 'http://x').pathname.split('/').pop() ?? '');
  if (!Object.hasOwn(ROUTES, name)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end('{"ok":false,"error":"Route inconnue."}');
  }
  return serve(name, req, res);
};
