// Serveur Node pour le VPS : le site (dist/) et l'API dans le même process, exactement
// comme sur Vercel. Node gère les requêtes en parallèle (l'agent attend surtout le modèle),
// le plafond AGENT_CONCURRENCY protège le quota.
//
//   npm run build && npm start        (PORT, défaut 3000)
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, serve } from './http.js';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function staticFile(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    await stat(file);
  } catch {
    file = path.join(DIST, 'index.html');
  }
  res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  createReadStream(file).pipe(res);
}

// extra(req, res) : routes en plus (app desktop) ; retourne vrai si la requête est prise en charge.
export function createApp(extra) {
  return createServer((req, res) => {
    if (extra?.(req, res)) return;
    const route = new URL(req.url, 'http://localhost').pathname.match(/^\/api\/([a-z]+)$/)?.[1];
    if (route) {
      if (!(route in ROUTES)) {
        res.statusCode = 404;
        return res.end();
      }
      return serve(route, req, res);
    }
    return staticFile(req, res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`salacv sur http://localhost:${port}`));
}
