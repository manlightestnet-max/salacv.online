// Durée de vie des clés KEYGEN, en jours, comptée à partir de l'activation.
//
// À FIXER à la fin des modifications (valeur codée en dur dans l'app, comme convenu).
// Tant que la valeur est `null`, aucune clé de ce type ne peut être activée : on ne devine pas.
//   offline : clé autonome, vérifiée sur le PC sans Internet (début gardé sur ce PC)
//   online  : clé opaque, connue du serveur, révocable (début et fin gardés côté serveur)
export const KEY_LIFETIME_DAYS = { offline: null, online: null };

export const lifetimeDays = (kind) => {
  const days = KEY_LIFETIME_DAYS[kind];
  return Number.isFinite(days) && days > 0 ? days : null;
};

// App desktop : la connexion (Google ou clé) est-elle obligatoire pour utiliser l'éditeur ?
// `false` tant que la durée de vie des clés n'est pas fixée : la page d'accueil propose alors
// « Continuer sans compte ». À passer à `true` en même temps que KEY_LIFETIME_DAYS.
export const REQUIRE_LOGIN = false;
