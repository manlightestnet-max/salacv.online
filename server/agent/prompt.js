// Messages envoyés au modèle : identité + skills (système), puis le CV actuel et la demande.
import { IDENTITY } from './identity.js';
import { allSkills } from './skills/index.js';
import { view } from './state.js';

const MAX_HISTORY = 6;
const MAX_MESSAGE = 4000;
// La demande en cours peut porter le texte lu sur une image jointe (un CV entier) : plus de place.
const MAX_REQUEST = 9000;

export function system() {
  const catalog = allSkills().map((s) => `- ${s.slug} : ${s.title} — ${s.description}`).join('\n');
  return `${IDENTITY}\n\n# Skills disponibles (load_skill)\n${catalog}\n\nDate du jour : ${new Date().toISOString().slice(0, 10)}.`;
}

// extra : { memory: [{ key, value }], versions: [{ key, label }], loggedIn } — ce que l'agent doit savoir en plus du CV.
export function build(state, message, history = [], extra = {}) {
  const messages = [{ role: 'system', content: system() }];
  // Historique court (texte seul) pour les demandes de suivi : « et rajoute aussi… ».
  const keep = Number.isInteger(extra.historySent) ? extra.historySent : MAX_HISTORY;
  for (const turn of (Array.isArray(history) ? history : []).slice(keep > 0 ? -keep : history.length)) {
    if ((turn?.role === 'user' || turn?.role === 'assistant') && typeof turn.text === 'string') {
      messages.push({ role: turn.role, content: turn.text.slice(0, MAX_MESSAGE) });
    }
  }
  messages.push({
    role: 'user',
    content: [
      `[CV ACTUEL — données de l'étudiant]\n${JSON.stringify(view(state), null, 1)}`,
      extra.versions?.length && `[VERSIONS DE CE CV — pour generate_cv]\n${extra.versions.map((v) => `- ${v.key} : ${v.label}`).join('\n')}`,
      extra.memory?.length && `[PRÉFÉRENCES RETENUES — à respecter]\n${extra.memory.map((m) => `- ${m.key} : ${m.value}`).join('\n')}`,
      `[COMPTE] ${extra.loggedIn ? 'connecté' : 'visiteur non connecté (pas de mémoire, PDF avec filigrane)'}`,
      `[DEMANDE DE L'ÉTUDIANT]\n${message.slice(0, MAX_REQUEST)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  return messages;
}
