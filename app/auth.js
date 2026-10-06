// Connexion Google (Firebase). Deux usages :
//   • web      : /auth/?next=/dashboard/        → jeton vérifié par /api/google, session enregistrée, retour à `next`
//   • desktop  : /auth/?desktop=1&port=…&state=… → ouverte par l'app Electron dans le navigateur du PC ;
//                le jeton est renvoyé à l'app sur son port local (127.0.0.1), qui le vérifie et ouvre la session.
//
// Google s'ouvre dans CET onglet (redirection), pas dans une fenêtre surgissante que le navigateur peut bloquer.
// La redirection exige que la page de retour de Firebase soit sur notre propre domaine : /__/auth/* est relayé vers
// firebaseapp.com (vercel.json), et https://<site>/__/auth/handler doit être autorisé dans Google Cloud.
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  getRedirectResult,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const desktop = params.get('desktop') === '1';
const APP_PORTS = [47831, 47832, 47833, 47834]; // les seuls ports sur lesquels l'app desktop écoute
const port = Number(params.get('port'));
const state = params.get('state') ?? '';
const adminMode = params.get('admin') === '1'; // connexion de l'administrateur (UID comparé côté serveur)
const returning = params.get('g') === '1'; // retour de Google (marque posée juste avant la redirection)
// Redirection sur le site en ligne (https, relais /__/auth/) ; fenêtre Google seulement en développement local.
const useRedirect = location.protocol === 'https:';

// Retour limité à une page du site (jamais une adresse externe).
const next = (() => {
  const n = params.get('next') ?? '';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/dashboard/';
})();

// Configuration Firebase : réglée par l'admin dans son interface (lue ici à l'exécution, rien à redéployer) ;
// à défaut, les variables VITE_FIREBASE_* du build.
async function loadConfig() {
  const fallback = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'lightpay-a5f01.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'lightpay-a5f01',
  };
  try {
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const { ok, config } = await res.json();
    if (!ok || !config) return fallback;
    return {
      apiKey: config['firebase.apiKey'] || fallback.apiKey,
      authDomain: config['firebase.authDomain'] || fallback.authDomain,
      projectId: config['firebase.projectId'] || fallback.projectId,
    };
  } catch {
    return fallback;
  }
}

// --- Retour visuel ------------------------------------------------------------------------
const button = $('auth-google');
const label = $('auth-label');
const statusLine = $('auth-status');
const error = $('auth-error');
const READY = 'Continuer avec Google';

// ready : cliquable · busy : spinner · done : connecté · locked : impossible (configuration, lien invalide)
function setButton(kind, text) {
  button.dataset.state = kind;
  button.disabled = kind !== 'ready';
  label.textContent = text;
}
function say(text, ok = false) {
  statusLine.textContent = text;
  statusLine.toggleAttribute('data-ok', ok);
  statusLine.hidden = !text;
}

let leaving = false; // une redirection est en cours (session trouvée ou connexion lancée)
const fail = (message, lock = false) => {
  leaving = false;
  say('');
  error.textContent = message;
  error.hidden = false;
  setButton(lock ? 'locked' : 'ready', READY);
};

if (adminMode) $('auth-text').textContent = 'Administration : connecte-toi avec le compte Google de l’administrateur.';
if (desktop) $('auth-text').textContent = 'Connecte-toi avec Google, puis reviens dans l’app salacv : elle s’ouvrira toute seule.';
if (adminMode || desktop) $('auth-title').textContent = 'Connexion';
const desktopLinkOk = !desktop || (APP_PORTS.includes(port) && /^[0-9a-f]{32}$/.test(state));

const FRIENDLY = {
  'auth/popup-closed-by-user': 'La fenêtre Google a été fermée avant la fin. Réessaie.',
  'auth/cancelled-popup-request': 'Une autre fenêtre de connexion est déjà ouverte.',
  'auth/popup-blocked': 'Ton navigateur a bloqué la fenêtre Google. Autorise-la puis réessaie.',
  'auth/network-request-failed': 'Pas de connexion Internet. Vérifie ton réseau puis réessaie.',
  'auth/unauthorized-domain': 'Ce domaine n’est pas autorisé pour la connexion Google.',
  'auth/user-cancelled': 'Connexion annulée. Réessaie quand tu veux.',
  'auth/web-storage-unsupported': 'Ton navigateur bloque la connexion (mode privé strict ?). Essaie une fenêtre normale.',
};
const friendly = (err) => FRIENDLY[err?.code] ?? 'La connexion a échoué. Réessaie dans un instant.';

// --- Session déjà ouverte -------------------------------------------------------------------
// Dans cet onglet ou un autre → on repart directement, sans redemander Google. Vérifié au chargement et chaque fois
// que l'onglet redevient visible. Pas pour le desktop : la session vit dans l'app.
function goTo(url, text = 'Déjà connecté') {
  leaving = true;
  $('auth-title').textContent = text;
  setButton('done', 'Connecté');
  say('Ouverture de ton espace…', true);
  location.replace(url);
}
async function alreadySignedIn() {
  if (desktop || leaving) return false;
  try {
    const res = await fetch(adminMode ? '/api/admin' : '/api/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adminMode ? { action: 'session' } : {}),
    });
    const d = await res.json();
    if (!(adminMode ? d.ok : d.ok && d.loggedIn) || leaving) return false;
    goTo(adminMode ? '/admin/' : next);
    return true;
  } catch {
    return false;
  }
}
const recheck = () => button.dataset.state === 'ready' && alreadySignedIn();
window.addEventListener('focus', recheck);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recheck());

// --- Connexion ------------------------------------------------------------------------------
let auth = null;
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' }); // laisse choisir le compte au lieu de reprendre le dernier

// Firebase ne garde rien dans le navigateur (mémoire seulement) : seul le jeton d'identité sert, une fois.
function makeAuth(config) {
  const authDomain = useRedirect ? location.host : config.authDomain;
  return initializeAuth(initializeApp({ ...config, authDomain }), { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
}

// Jeton Google obtenu → session salacv (ou retour vers l'app desktop).
async function finish(result) {
  leaving = true;
  $('auth-title').textContent = 'Connexion en cours…';
  setButton('busy', 'Connexion…');
  say('Vérification de ton compte…');
  const idToken = await result.user.getIdToken();
  signOut(auth).catch(() => {});
  if (desktop) {
    $('auth-title').textContent = 'Retour vers l’app…';
    setButton('done', 'Connecté');
    say('C’est bon : l’app salacv s’ouvre. Tu peux fermer cet onglet.', true);
    // Navigation de premier niveau vers le port local : le jeton reste dans le fragment (jamais envoyé au réseau).
    location.replace(`http://127.0.0.1:${port}/__desktop/callback#idToken=${encodeURIComponent(idToken)}&state=${encodeURIComponent(state)}`);
    return;
  }
  const res = await fetch(adminMode ? '/api/admin' : '/api/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adminMode ? { action: 'login', idToken } : { idToken }),
  }).catch(() => null);
  if (!res) return fail('Le serveur ne répond pas. Vérifie ta connexion puis réessaie.');
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data.ok) return fail(data.error || 'Connexion refusée. Réessaie.');
  goTo(adminMode ? '/admin/' : next, 'Connecté');
}

button.addEventListener('click', async () => {
  if (leaving) return;
  error.hidden = true;
  if (!navigator.onLine) return fail('Pas de connexion Internet. La connexion Google en a besoin.');
  leaving = true;
  try {
    // La configuration se charge en arrière-plan depuis l'ouverture de la page : on ne l'attend qu'ici, au besoin.
    if (!auth) {
      setButton('busy', 'Ouverture de Google…');
      const config = await configReady;
      if (!config.apiKey) return fail('La connexion Google n’est pas encore configurée : l’administrateur doit renseigner la clé Firebase.', true);
      auth = makeAuth(config);
    }
    if (useRedirect) {
      setButton('busy', 'Ouverture de Google…');
      say('Tu choisis ton compte chez Google, puis tu reviens ici automatiquement.');
      // Marque le retour dans l'adresse : à la fin, Google ramène exactement ici.
      const url = new URL(location.href);
      url.searchParams.set('g', '1');
      history.replaceState(null, '', url);
      await signInWithRedirect(auth, provider);
      return;
    }
    setButton('busy', 'Fenêtre Google ouverte…');
    await finish(await signInWithPopup(auth, provider));
  } catch (err) {
    fail(friendly(err));
  }
});

// --- Démarrage --------------------------------------------------------------------------------
// Le bouton est utilisable tout de suite. Rien n'attend avant le clic, sauf au retour de Google (on termine la connexion).
// En arrière-plan : la configuration Firebase, et une session déjà ouverte (dans ce cas, on repart directement).
const configReady = loadConfig();

async function start() {
  if (!desktopLinkOk) return fail('Lien invalide. Relance la connexion depuis l’app salacv.', true);
  showTemplates();
  showProof();
  if (!returning) {
    setButton('ready', READY);
    alreadySignedIn();
    return;
  }
  $('auth-title').textContent = 'Connexion en cours…';
  setButton('busy', 'Retour de Google…');
  say('Un instant, on termine ta connexion.');
  const url = new URL(location.href);
  url.searchParams.delete('g');
  history.replaceState(null, '', url); // un rechargement ne repasse pas par ici
  const config = await configReady;
  if (!config.apiKey) return fail('La connexion Google n’est pas encore configurée : l’administrateur doit renseigner la clé Firebase.', true);
  auth = makeAuth(config);
  try {
    const result = await getRedirectResult(auth);
    if (result) return await finish(result);
  } catch (err) {
    return fail(friendly(err));
  }
  // Revenu sans résultat (connexion abandonnée chez Google) : on repart du bouton.
  $('auth-title').textContent = 'Bienvenue sur salacv';
  say('');
  setButton('ready', READY);
  alreadySignedIn();
}

// Vraies informations : cadeau d'inscription, CV préparés, note moyenne (serveur) ; rien n'apparaît sans donnée.
function showProof() {
  if (desktop || adminMode) return;
  fetch('/api/stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => r.json())
    .then((s) => {
      if (!s.ok) return;
      const gains = $('auth-gains');
      if (s.signupCredits > 0) {
        const li = document.createElement('li');
        li.className = 'gain gift';
        li.innerHTML = '<span class="gain-icon" aria-hidden="true">🎁</span><span><strong></strong><small>Pour préparer tes premiers CV sans filigrane</small></span>';
        li.querySelector('strong').textContent = `${s.signupCredits} crédit${s.signupCredits > 1 ? 's' : ''} offert${s.signupCredits > 1 ? 's' : ''}`;
        gains.prepend(li);
      }
      const parts = [];
      if (s.cvs > 0) parts.push(`${Number(s.cvs).toLocaleString('fr-FR')} CV préparés`);
      if (s.rating) parts.push(`★ ${String(s.rating.average).replace('.', ',')} sur ${Number(s.rating.count).toLocaleString('fr-FR')} avis`);
      if (parts.length) {
        $('auth-proof').textContent = parts.join(' · ');
        $('auth-proof').hidden = false;
      }
    })
    .catch(() => {});
}

// Grand écran : les modèles défilent à côté (moteur chargé à part, sans retarder la connexion).
function showTemplates() {
  const root = $('auth-show-cols');
  if (!root || !matchMedia('(min-width: 900px)').matches) return;
  import('./auth-showcase.js').then((m) => m.showTemplates(root)).catch(() => {});
}

start().catch((err) => fail(friendly(err)));
