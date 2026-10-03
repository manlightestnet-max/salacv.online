import { LIMITS, text } from '../state.js';
import { params } from './base.js';

export default {
  name: 'set_summary',
  description: 'Écrit ou remplace le profil professionnel (2 à 4 phrases, un paragraphe par ligne).',
  parameters: params({ text: { type: 'string' } }, ['text']),
  run(run, args) {
    const value = text(args.text, LIMITS.summary);
    if (!value) return { error: 'Texte vide.' };
    run.state.profile.summary = value;
    run.changes.add('profil professionnel');
    return { ok: true };
  },
};
