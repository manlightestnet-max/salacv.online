// Visiteurs (Admin → Visiteurs) : arrivée sur la page, signe de vie toutes les 20 s tant qu'elle est visible, départ.
// Rien n'est gardé dans le navigateur : le serveur reconnaît le visiteur par son cookie anonyme (httpOnly) et masque
// l'IP. Seul le chemin de la page part (jamais ?p=… : un CV privé), et le domaine d'où il vient.
const PING_MS = 20_000;

function send(type, extra = {}) {
  const body = JSON.stringify({ type, path: location.pathname, ...extra });
  try {
    // Départ : la page se ferme peut-être, le signe doit partir quand même.
    if (type === 'leave' && navigator.sendBeacon?.('/api/track', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {}
}

function source() {
  const utm = new URLSearchParams(location.search).get('utm_source');
  if (utm) return utm;
  try {
    const ref = document.referrer && new URL(document.referrer);
    return ref && ref.host !== location.host ? ref.hostname : '';
  } catch {
    return '';
  }
}

let started = false;
export function startTracking() {
  if (started || navigator.webdriver) return;
  started = true;
  send('view', { source: source() });
  let timer = setInterval(() => send('ping'), PING_MS);
  document.addEventListener('visibilitychange', () => {
    clearInterval(timer);
    if (document.visibilityState === 'hidden') return send('leave');
    send('ping');
    timer = setInterval(() => send('ping'), PING_MS);
  });
  window.addEventListener('pagehide', () => send('leave'));
}
