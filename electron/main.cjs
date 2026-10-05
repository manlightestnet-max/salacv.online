// Version desktop : le serveur Node (site dist/ + API) tourne dans le process principal,
// la fenêtre charge http://127.0.0.1:<port>. Même code que sur le VPS.
//
// Le port est FIXE : le navigateur intégré range la connexion et les CV dans le stockage de
// l'origine (adresse + port). Avec un port aléatoire à chaque lancement, tout serait perdu.
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PORTS = [47831, 47832, 47833, 47834]; // le premier libre ; le même d'un lancement à l'autre
let server;
let origin = '';
let mainWindow = null;

// Page de connexion Google (hébergée avec le site) : elle s'ouvre dans le navigateur du PC, car Google
// refuse la connexion dans une fenêtre intégrée d'Electron.
const AUTH_ORIGIN = (process.env.SALACV_AUTH_ORIGIN || 'https://smlab-theta.vercel.app').replace(/\/$/, '');
const saved = new Set(); // seuls les fichiers enregistrés par l'app peuvent être ouverts ou montrés

// Seule notre propre page peut appeler ces fonctions.
const trusted = (event) => origin && String(event.senderFrame?.url ?? '').startsWith(origin);

// --- Connexion : appareil, clé hors ligne, retour de Google -------------------------------------
const userFile = (name) => path.join(app.getPath('userData'), name);

// Identifiant de ce PC, créé une fois (lie une clé en ligne à un seul appareil).
function deviceId() {
  const file = userFile('device.json');
  try {
    const id = JSON.parse(fsSync.readFileSync(file, 'utf8')).id;
    if (typeof id === 'string' && id.length >= 16) return id;
  } catch {}
  const id = crypto.randomBytes(16).toString('hex');
  fsSync.writeFileSync(file, JSON.stringify({ id }));
  return id;
}

// Clé hors ligne : état gardé dans userData, chiffré par le système quand c'est possible.
const licenseStorage = {
  read() {
    try {
      const raw = fsSync.readFileSync(userFile('license.bin'));
      return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
    } catch {
      return null;
    }
  },
  write(data) {
    const text = JSON.stringify(data);
    fsSync.writeFileSync(userFile('license.bin'), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text);
  },
};
let licensePromise = null;
function getLicense() {
  licensePromise ??= (async () => {
    const [{ createLicense }, { PUBLIC_KEY }] = await Promise.all([
      import(pathToFileURL(path.join(__dirname, '../src/license/activation.js')).href),
      import(pathToFileURL(path.join(__dirname, '../src/license/public-key.js')).href),
    ]);
    return createLicense({ storage: licenseStorage, publicKey: PUBLIC_KEY });
  })();
  return licensePromise;
}

// --- Backend en ligne --------------------------------------------------------------------------
// L'app desktop est un client léger : l'interface est servie ici, mais TOUT /api/* part vers le
// backend en ligne (Vercel + Neon). Aucun secret, aucune clé, aucune base ne vit sur le PC.
const BACKEND_TIMEOUT_MS = 75_000;
const UNREACHABLE = { ok: false, error: 'Le serveur salacv est injoignable. Vérifie ta connexion Internet puis réessaie.' };

async function callBackend(apiPath, payload, headers = {}) {
  try {
    const res = await fetch(`${AUTH_ORIGIN}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Salacv-Client': 'desktop', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' })) };
  } catch {
    return { status: 503, body: UNREACHABLE };
  }
}

// Relaie une requête /api/<route> de la page (JSON, jeton d'autorisation) vers le backend.
async function relayApi(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { ok: false, error: 'Méthode non autorisée.' });
  if (!/^\/api\/[a-z]+$/.test(new URL(req.url, 'http://127.0.0.1').pathname)) return send(404, { ok: false, error: 'Route inconnue.' });
  let payload;
  try {
    payload = await readSmallJson(req, 2 * 1024 * 1024);
  } catch {
    return send(400, { ok: false, error: 'Requête invalide.' });
  }
  const auth = req.headers.authorization ? { Authorization: String(req.headers.authorization) } : {};
  const { status, body } = await callBackend(new URL(req.url, 'http://127.0.0.1').pathname, payload, auth);
  send(status, body);
}

// Retour de Google : le navigateur arrive sur /__desktop/callback#idToken=…&state=…, la page renvoie le jeton
// ici (même origine), on le vérifie avec le serveur local et on ouvre la session dans la fenêtre de l'app.
const pendingGoogle = new Map(); // state → expiration

function readSmallJson(req, max = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => (size += c.length) > max ? (reject(new Error('too large')), req.destroy()) : chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const CALLBACK_PAGE = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>salacv</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d11;color:#f3f5f8;font:16px/1.5 system-ui,sans-serif}main{max-width:340px;text-align:center;padding:24px}</style>
<main><p id="m">Connexion en cours…</p></main>
<script>
var p = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', '/__desktop/callback');
fetch('/__desktop/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: p.get('idToken'), state: p.get('state') }) })
  .then(function (r) { return r.json(); })
  .then(function (d) { document.getElementById('m').textContent = d.ok ? 'Connexion réussie. Tu peux fermer cet onglet et revenir à salacv.' : (d.error || 'Connexion refusée.'); })
  .catch(function () { document.getElementById('m').textContent = 'Connexion impossible. Reviens dans salacv et réessaie.'; });
</script></html>`;

// Brancher sur le serveur local (createApp(extra)). Retourne vrai si la requête est à nous.
function desktopRoutes(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    relayApi(req, res);
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/__desktop/callback') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(CALLBACK_PAGE);
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/__desktop/token') {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    (async () => {
      if (req.headers.origin && req.headers.origin !== origin) return reply(403, { ok: false, error: 'Origine refusée.' });
      const { idToken, state } = await readSmallJson(req);
      const expires = pendingGoogle.get(String(state));
      pendingGoogle.delete(String(state)); // usage unique
      if (!expires || expires < Date.now()) return reply(400, { ok: false, error: 'Cette connexion a expiré. Relance-la depuis l’app.' });
      const { status, body } = await callBackend('/api/google', { idToken });
      if (!body.ok) return reply(status, body);
      const session = { token: body.token, username: body.username, name: body.name, kind: 'google' };
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.webContents.executeJavaScript(`localStorage.setItem('salacv:session', ${JSON.stringify(JSON.stringify(session))}); location.replace('/dashboard/'); true`);
        mainWindow.show();
        mainWindow.focus();
      }
      reply(200, { ok: true });
    })().catch(() => reply(400, { ok: false, error: 'Requête invalide.' }));
    return true;
  }
  return false;
}

function registerIpc(getWindow) {
  ipcMain.handle('desktop:device', (event) => (trusted(event) ? deviceId() : null));
  ipcMain.handle('desktop:license', async (event, { action, key } = {}) => {
    if (!trusted(event)) return { ok: false, error: 'refused' };
    const license = await getLicense();
    if (action === 'activate') return license.activate(String(key ?? ''));
    if (action === 'clear') return license.clear();
    return license.status();
  });
  ipcMain.handle('desktop:google-start', async (event) => {
    if (!trusted(event)) return { ok: false };
    const state = crypto.randomBytes(16).toString('hex');
    for (const [k, t] of pendingGoogle) if (t < Date.now()) pendingGoogle.delete(k);
    pendingGoogle.set(state, Date.now() + 10 * 60 * 1000);
    const port = new URL(origin).port;
    await shell.openExternal(`${AUTH_ORIGIN}/auth/?desktop=1&port=${port}&state=${state}`);
    return { ok: true };
  });
  ipcMain.handle('desktop:save', async (event, { name, data, filters }) => {
    if (!trusted(event) || !(data instanceof ArrayBuffer || ArrayBuffer.isView(data))) return { ok: false, error: 'refused' };
    const safe = String(name || 'CV').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
    const pick = await dialog.showSaveDialog(getWindow(), {
      title: 'Enregistrer mon CV',
      defaultPath: path.join(app.getPath('documents'), safe),
      filters: Array.isArray(filters) ? filters.slice(0, 3) : undefined,
    });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    await fs.writeFile(pick.filePath, Buffer.from(data instanceof ArrayBuffer ? data : data.buffer));
    saved.add(pick.filePath);
    return { ok: true, path: pick.filePath };
  });
  ipcMain.handle('desktop:open', async (event, file) => (trusted(event) && saved.has(file) ? shell.openPath(file) : 'refused'));
  ipcMain.handle('desktop:reveal', (event, file) => {
    if (trusted(event) && saved.has(file)) shell.showItemInFolder(file);
  });
}

async function listen(srv) {
  for (const port of PORTS) {
    try {
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(port, '127.0.0.1', () => (srv.removeListener('error', reject), resolve()));
      });
      return port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve)); // dernier recours
  return srv.address().port;
}

async function startServer() {
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '../server/index.js')).href);
  server = createApp(desktopRoutes);
  return listen(server);
}

// Écran de démarrage : affiché tout de suite, pendant que le serveur local et la fenêtre se préparent.
const SPLASH_MIN_MS = 1400; // assez long pour être vu, jamais plus long que nécessaire
let splash = null;
let splashAt = 0;
function showSplash() {
  splashAt = Date.now();
  splash = new BrowserWindow({
    width: 380,
    height: 260,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: '#0b0d11',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.once('ready-to-show', () => splash?.show());
  splash.loadFile(path.join(__dirname, 'splash.html'));
}
function closeSplash(then) {
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashAt));
  setTimeout(() => {
    then();
    if (splash && !splash.isDestroyed()) splash.destroy();
    splash = null;
  }, wait);
}

async function createWindow() {
  showSplash();
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d11',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  origin = `http://127.0.0.1:${port}`;
  // Les liens externes s'ouvrent dans le navigateur, pas dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow = win;
  win.once('ready-to-show', () => closeSplash(() => win.show()));
  // Déjà connecté → tableau de bord ; sinon → éditeur (voir app/desktop.html).
  win.loadURL(`${origin}/desktop.html`);
  return win;
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  let win = null;
  registerIpc(() => win);
  app.whenReady().then(async () => (win = await createWindow()));
  app.on('window-all-closed', () => app.quit());
  app.on('quit', () => server?.close());
}
