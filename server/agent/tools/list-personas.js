import { params } from './base.js';

// Lecture seule : les personnalités de l'utilisateur (informations de base gardées une fois), envoyées par le studio.
export default {
  name: 'list_personas',
  description:
    "Consulte les personnalités de l'utilisateur (ses profils de base : nom, profession, formations, expériences). Lecture seule, " +
    "pour répondre à une question ou s'en inspirer s'il le demande ; ne modifie rien.",
  parameters: params(),
  run(run) {
    const personas = run.context?.personas ?? [];
    return personas.length ? { personas } : { personas: [], note: "L'utilisateur n'a encore aucune personnalité." };
  },
};
