// Page d'accueil de l'app desktop : connexion Google ou clé, avant l'éditeur.
import { loginPanel } from './login.js';
import { REQUIRE_LOGIN } from '../src/license/config.js';

document.getElementById('welcome-login').append(
  loginPanel({
    // Clé en ligne : session ouverte. Clé hors ligne : accès à l'app sur ce PC. Dans les deux cas, on entre.
    onDone: () => setTimeout(() => location.replace('/dashboard/'), 900),
  }),
);

// Tant que les clés ne sont pas en service, on peut entrer sans compte (voir REQUIRE_LOGIN).
document.getElementById('welcome-skip').hidden = REQUIRE_LOGIN;
