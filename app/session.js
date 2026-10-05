// Qui est connecté ? Le serveur le sait par un cookie httpOnly que le JavaScript de la page ne peut ni lire ni écrire :
// il n'y a plus aucun jeton ni aucune session dans le navigateur. On demande l'identité au serveur au chargement de la page.
let current = null; // { username, name, kind, picture, since, lastLogin, logins } ou null

export async function initSession() {
  try {
    const res = await fetch('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json();
    current = d.ok && d.loggedIn
      ? { username: d.username, name: d.name, kind: d.kind, picture: d.picture ?? '', since: d.since ?? null, lastLogin: d.lastLogin ?? null, logins: d.logins ?? 0 }
      : null;
  } catch {
    current = null; // serveur injoignable : on se comporte en visiteur
  }
  return current;
}

export const getSession = () => current;
export const forgetSession = () => (current = null);

// Déconnexion : le serveur efface le cookie.
export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch {}
  current = null;
}
