import { language, LEVELS, MAX } from '../state.js';
import { params } from './base.js';

export default {
  name: 'set_languages',
  description: `Ajoute ou met à jour des langues (mode=replace pour remplacer toute la liste). Niveaux : ${LEVELS.join(', ')}.`,
  parameters: params(
    {
      mode: { type: 'string', enum: ['merge', 'replace'] },
      languages: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, level: { type: 'string', enum: LEVELS } }, required: ['name'] },
      },
    },
    ['languages'],
  ),
  run(run, args) {
    const langs = (Array.isArray(args.languages) ? args.languages : []).map(language).filter((l) => l.name).slice(0, MAX.languages);
    const current = run.state.languages.filter((l) => l.name);
    if (args.mode === 'replace') current.splice(0, current.length, ...langs);
    else {
      for (const lang of langs) {
        const existing = current.find((c) => c.name.toLowerCase() === lang.name.toLowerCase());
        if (existing) existing.level = lang.level || existing.level;
        else current.push(lang);
      }
    }
    run.state.languages = current;
    run.changes.add('langues');
    return { ok: true, languages: current };
  },
};
