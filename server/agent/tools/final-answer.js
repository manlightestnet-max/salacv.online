import { params } from './base.js';

export default {
  name: 'final_answer',
  description:
    "TERMINE et envoie ta réponse à l'étudiant. Appelle-le une fois le CV modifié avec les autres outils. " +
    'Le texte résume en une ou deux phrases ce que tu as fait, ou pose UNE question s’il manque une information importante. ' +
    'N’y annonce jamais une action pas encore faite (« je vais… », « un instant ») : fais-la d’abord.',
  parameters: params({ text: { type: 'string', description: "Message court pour l'étudiant, en français, tutoiement." } }, ['text']),
  // Traité par la boucle (loop.js) : cet atome ne sert qu'à déclarer l'outil.
  run: () => ({ ok: true }),
};
