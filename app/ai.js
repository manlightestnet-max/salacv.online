// Appel de l'assistant depuis une fenêtre d'édition : l'étudiant écrit comme il parle,
// l'agent met en forme un seul champ du CV. Même route et même session que l'assistant.
const SESSION_KEY = 'salacv:session';

export function aiSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

// state sans photo ni modèle (ils ne quittent jamais le navigateur). → { ok, state, reply, error }
export async function askAgent(state, message) {
  const token = aiSession()?.token;
  if (!token) return { ok: false, login: true, error: 'Connecte-toi à l’assistant pour utiliser l’IA.' };
  const { photo, ...profile } = state.profile;
  let res;
  try {
    res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ state: { ...state, profile, template: undefined }, message }),
    });
  } catch {
    return { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' };
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
  if (res.status === 401) return { ok: false, login: true, error: data.error };
  return data;
}
