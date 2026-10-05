// Appel de l'assistant depuis une fenêtre d'édition : l'étudiant écrit comme il parle,
// l'agent met en forme un seul champ du CV. Même route et même session que l'assistant.
import { publishQuota } from './quotabar.js';
import { getSession } from './session.js';

export const aiSession = getSession;

// state sans photo ni modèle (ils ne quittent jamais le navigateur). → { ok, state, reply, error }
// opts : { scope (étape du studio : outils limités à cette section), history (le fil de l'étape) }
// Connecté : avec son jeton. Visiteur web : sans jeton, sur les clés publiques et le quota de 250 000 tokens (serveur).
// App desktop : connexion obligatoire.
export async function askAgent(state, message, { scope, history } = {}) {
  if (!getSession() && window.desktop?.isDesktop) return { ok: false, login: true, error: 'Connecte-toi à l’assistant pour utiliser l’IA.' };
  const { photo, ...profile } = state.profile;
  let res;
  try {
    res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { ...state, profile, template: undefined }, message, scope, history }),
    });
  } catch {
    return { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' };
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
  publishQuota(data.quota);
  if (res.status === 401) return { ok: false, login: true, error: data.error };
  if (data.code === 'QUOTA') return { ...data, login: true };
  return data;
}
