import { item, TIMELINES } from '../state.js';
import { params, SECTION } from './base.js';

export default {
  name: 'update_entry',
  description: 'Modifie un bloc existant (index donné dans le CV actuel). Ne passe que les champs à changer ; details remplace toutes les lignes.',
  parameters: params(
    {
      section: SECTION,
      index: { type: 'integer' },
      period: { type: 'string' },
      title: { type: 'string' },
      org: { type: 'string' },
      details: { type: 'array', items: { type: 'string' } },
    },
    ['section', 'index'],
  ),
  run(run, args) {
    if (!(args.section in TIMELINES)) return { error: 'section doit valoir education ou experiences.' };
    const items = run.state[args.section];
    const { index } = args;
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return { error: `index invalide : utilise un index donné par le CV actuel (0 à ${items.length - 1}).` };
    }
    const changes = Object.fromEntries(['period', 'title', 'org', 'details'].filter((k) => args[k] != null).map((k) => [k, args[k]]));
    items[index] = item({ ...items[index], ...changes });
    run.changes.add(TIMELINES[args.section].toLowerCase());
    return { ok: true, entry: items[index] };
  },
};
