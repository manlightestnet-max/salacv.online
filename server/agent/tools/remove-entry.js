import { TIMELINES } from '../state.js';
import { params, SECTION } from './base.js';

export default {
  name: 'remove_entry',
  description: "Supprime un bloc de formation ou d'expérience, uniquement si l'étudiant le demande.",
  parameters: params({ section: SECTION, index: { type: 'integer' } }, ['section', 'index']),
  run(run, args) {
    if (!(args.section in TIMELINES)) return { error: 'section doit valoir education ou experiences.' };
    const items = run.state[args.section];
    if (!Number.isInteger(args.index) || args.index < 0 || args.index >= items.length) return { error: 'index invalide.' };
    const [removed] = items.splice(args.index, 1);
    run.changes.add(TIMELINES[args.section].toLowerCase());
    return { ok: true, removed: removed.title, info: 'Les index suivants ont diminué de 1.' };
  },
};
