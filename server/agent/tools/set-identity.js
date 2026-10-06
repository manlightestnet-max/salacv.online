import { LIMITS, phones, text } from '../state.js';
import { params } from './base.js';

const FIELDS = { name: 'name', title: 'title', email: 'email', address: 'address', link: 'link' };

export default {
  name: 'set_identity',
  description: "Remplit ou corrige l'en-tête du CV. Ne passe que les champs à changer. phones remplace toute la liste (3 numéros maximum).",
  parameters: params({
    name: { type: 'string', description: 'Nom complet' },
    title: { type: 'string', description: 'Profession ou domaine, ex. « Technicienne en réseaux et télécommunications »' },
    email: { type: 'string' },
    phones: { type: 'array', items: { type: 'string' }, description: 'Numéros au format +242 06 612 34 56' },
    address: { type: 'string', description: 'Adresse, ex. « 12, rue Mbochis, Poto-Poto, Brazzaville »' },
    link: { type: 'string', description: 'Un lien (LinkedIn, portfolio), facultatif' },
  }),
  run(run, args) {
    const p = run.state.profile;
    const done = [];
    for (const [key, limit] of Object.entries(FIELDS)) {
      if (args[key] != null) {
        p[key] = text(args[key], LIMITS[limit]);
        done.push(key);
      }
    }
    if (Array.isArray(args.phones)) {
      p.phones = phones(args.phones);
      done.push('phones');
    }
    if (!done.length) return { error: 'Aucun champ fourni.' };
    run.changes.add('identité');
    return { ok: true, profile: p };
  },
};
