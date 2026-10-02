import { LIMITS, LISTS, MAX, text } from '../state.js';
import { params } from './base.js';

export default {
  name: 'edit_list',
  description:
    'Compétences & certifications (section=skills) ou loisirs (section=hobbies) : ajouter, retirer ou remplacer toute la liste. Éléments courts.',
  parameters: params(
    {
      section: { type: 'string', enum: ['skills', 'hobbies'] },
      mode: { type: 'string', enum: ['add', 'remove', 'replace'] },
      items: { type: 'array', items: { type: 'string' } },
    },
    ['section', 'items'],
  ),
  run(run, args) {
    if (!(args.section in LISTS)) return { error: 'section doit valoir skills ou hobbies.' };
    const mode = args.mode || 'add';
    if (!['add', 'remove', 'replace'].includes(mode)) return { error: 'mode doit valoir add, remove ou replace.' };
    const items = (Array.isArray(args.items) ? args.items : []).map((i) => text(i, LIMITS.listItem)).filter(Boolean);
    const current = run.state[args.section];
    const has = (v) => current.some((c) => c.toLowerCase() === v.toLowerCase());
    if (mode === 'replace') current.length = 0;
    if (mode === 'remove') {
      const drop = new Set(items.map((i) => i.toLowerCase()));
      run.state[args.section] = current.filter((c) => !drop.has(c.toLowerCase()));
    } else {
      for (const i of items) if (!has(i) && current.length < MAX[args.section]) current.push(i);
    }
    run.changes.add(LISTS[args.section].toLowerCase());
    return { ok: true, [args.section]: run.state[args.section] };
  },
};
