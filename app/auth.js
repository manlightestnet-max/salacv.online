// Connexion Google (Firebase). Deux usages :
//   • web      : /auth/?next=/dashboard/        → jeton vérifié par /api/google, session enregistrée, retour à `next`
//   • desktop  : /auth/?desktop=1&port=…&state=… → ouverte par l'app Electron dans le navigateur du PC ;
//                le jeton est renvoyé à l'app sur son port local (127.0.0.1), qui le vérifie et ouvre la session.
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup } from 'firebase/auth';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const desktop = params.get('desktop') === '1';
const APP_PORTS = [47831, 47832, 47833, 47834]; // les seuls ports sur lesquels l'app desktop écoute
const port = Number(params.get('port'));
const state = params.get('state') ?? '';

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
let config = { apiKey: '' };

const button = $('auth-google');
const error = $('auth-error');
// lock : erreur bloquante (lien invalide, configuration absente) → le bouton reste désactivé.
const fail = (message, lock = false) => {
  error.textContent = message;
  error.hidden = false;
  button.disabled = lock;
};

if (desktop) {
  $('auth-text').textContent = 'Connecte-toi avec Google, puis reviens dans l’app salacv : elle s’ouvrira toute seule.';
  if (!APP_PORTS.includes(port) || !/^[0-9a-f]{32}$/.test(state)) {
    fail('Lien invalide. Relance la connexion depuis l’app salacv.', true);
  }
}
button.disabled = true;
loadConfig().then((c) => {
  config = c;
  if (!c.apiKey) return fail('La connexion Google n’est pas encore configurée : l’administrateur doit renseigner la clé Firebase.', true);
  if (!desktop || (APP_PORTS.includes(port) && /^[0-9a-f]{32}$/.test(state))) button.disabled = false;
});

const FRIENDLY = {
  'auth/popup-closed-by-user': 'La fenêtre Google a été fermée avant la fin. Réessaie.',
  'auth/cancelled-popup-request': 'Une autre fenêtre de connexion est déjà ouverte.',
  'auth/popup-blocked': 'Ton navigateur a bloqué la fenêtre Google. Autorise-la puis réessaie.',
  'auth/network-request-failed': 'Pas de connexion Internet. Vérifie ton réseau puis réessaie.',
  'auth/unauthorized-domain': 'Ce domaine n’est pas autorisé pour la connexion Google.',
};

button.addEventListener('click', async () => {
  error.hidden = true;
  if (!navigator.onLine) return fail('Pas de connexion Internet. La connexion Google en a besoin.');
  button.disabled = true;
  try {
    const auth = getAuth(initializeApp(config));
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = await result.user.getIdToken();
    if (desktop) {
      $('auth-title').textContent = 'Retour vers l’app…';
      // Navigation de premier niveau vers le port local : le jeton reste dans le fragment (jamais envoyé au réseau).
      location.replace(`http://127.0.0.1:${port}/__desktop/callback#idToken=${encodeURIComponent(idToken)}&state=${encodeURIComponent(state)}`);
      return;
    }
    const res = await fetch('/api/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) return fail(data.error || 'Connexion refusée. Réessaie.');
    localStorage.setItem('salacv:session', JSON.stringify({ token: data.token, username: data.username, name: data.name, kind: 'google' }));
    $('auth-title').textContent = 'Connecté';
    location.replace(next);
  } catch (err) {
    fail(FRIENDLY[err?.code] ?? 'La connexion a échoué. Réessaie dans un instant.');
  }
});
