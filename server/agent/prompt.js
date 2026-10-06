// Messages envoyés au modèle : identité + skills (système), puis le CV actuel et la demande.
import { IDENTITY } from './identity.js';
import { allSkills } from './skills/index.js';
import { view } from './state.js';

const MAX_HISTORY = 6;
const MAX_MESSAGE = 4000;

export function system() {
  const catalog = allSkills().map((s) => `- ${s.slug} : ${s.title} — ${s.description}`).join('\n');
  return `${IDENTITY}\n\n# Skills disponibles (load_skill)\n${catalog}\n\nDate du jour : ${new Date().toISOString().slice(0, 10)}.`;
}

// extra : { memory: [{ key, value }], versions: [{ key, label }], loggedIn } — ce que l'agent doit savoir en plus du CV.
export function build(state, message, history = [], extra = {}) {
  const messages = [{ role: 'system', content: system() }];
  // Historique court (texte seul) pour les demandes de suivi : « et rajoute aussi… ».
  for (const turn of (Array.isArray(history) ? history : []).slice(-MAX_HISTORY)) {
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
      `[DEMANDE DE L'ÉTUDIANT]\n${message.slice(0, MAX_MESSAGE)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  return messages;
}
