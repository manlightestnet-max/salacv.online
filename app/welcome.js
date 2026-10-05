// Page d'accueil de l'app desktop : connexion Google ou clé, avant l'éditeur.
import { loginPanel } from './login.js';
import { initSession } from './session.js';
import { REQUIRE_LOGIN } from '../src/license/config.js';

document.getElementById('welcome-login').append(
  loginPanel({
    // Google ou clé en ligne : session ouverte. Clé hors ligne : accès à l'app sur ce PC. Dans tous les cas, on entre.
    onDone: () => setTimeout(() => location.replace('/dashboard/'), 900),
  }),
);

// Tant que les clés ne sont pas en service, on peut entrer sans compte (voir REQUIRE_LOGIN).
document.getElementById('welcome-skip').hidden = REQUIRE_LOGIN;

// Déjà connecté (retour de Google pendant que la page était ouverte, rechargement…) → tableau de bord.
if (await initSession()) location.replace('/dashboard/');
