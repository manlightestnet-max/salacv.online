// Un outil = un atome : sa description pour le modèle et ce qu'il fait sur le CV.
// Chaque fichier de ce dossier exporte par défaut { name, description, parameters, run(run, args) }.
// `run` reçoit l'exécution en cours : { state, changes, flags }.

export const params = (properties = {}, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });

export const SECTION = {
  type: 'string',
  enum: ['education', 'experiences'],
  description: 'education = formation & certifications, experiences = expérience professionnelle',
};

export const spec = (tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters });
