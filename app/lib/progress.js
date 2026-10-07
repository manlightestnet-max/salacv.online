// Attentes obligatoires (chargement d'une page, d'un solde, d'un paiement) : une fine barre qui court sous la barre
// d'outils, comme dans les grandes apps. Elle n'apparaît qu'après 120 ms (un chargement instantané ne clignote pas)
// et reste tant qu'au moins une attente est en cours. Les rafraîchissements de fond (sondages) ne s'en servent pas.
let pending = 0;
let showTimer = 0;
const root = document.documentElement;

/** Rend la promesse telle quelle, la barre tourne pendant ce temps. */
export function trackWait(work) {
  pending += 1;
  if (pending === 1) showTimer = setTimeout(() => root.classList.add('waiting'), 120);
  return Promise.resolve(work).finally(() => {
    pending = Math.max(0, pending - 1);
    if (pending) return;
    clearTimeout(showTimer);
    root.classList.remove('waiting');
  });
}
