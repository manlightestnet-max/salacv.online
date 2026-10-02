import { item, MAX, TIMELINES } from '../state.js';
import { params, SECTION } from './base.js';

export default {
  name: 'add_entry',
  description:
    'Ajoute une formation/certification (section=education) ou une expérience (section=experiences). ' +
    "Format du CV : « période | titre — organisation », puis une ligne par détail. L'ordre chronologique est géré tout seul.",
  parameters: params(
    {
      section: SECTION,
      period: { type: 'string', description: "ex. « 2023 — 2026 », « Juin — Sept. 2025 », « 2024 — aujourd'hui »" },
      title: { type: 'string', description: 'Diplôme, certification ou poste' },
      org: { type: 'string', description: 'Établissement ou entreprise' },
      details: { type: 'array', items: { type: 'string' }, description: 'Une entrée par ligne : tâches, acquis (courts, verbes d’action)' },
    },
    ['section', 'title'],
  ),
  run(run, args) {
    if (!(args.section in TIMELINES)) return { error: 'section doit valoir education ou experiences.' };
    const entry = item(args);
    if (!entry.title) return { error: 'title est obligatoire.' };
    const items = run.state[args.section];
    if (items.length >= MAX.timeline) return { error: 'Trop de blocs dans cette section.' };
    // Remplace le bloc vide que le formulaire crée par défaut au lieu d'en ajouter un.
    let index = items.findIndex((it) => !Object.values(it).some(Boolean));
    if (index === -1) index = items.push(entry) - 1;
    else items[index] = entry;
    run.changes.add(TIMELINES[args.section].toLowerCase());
    return { ok: true, index };
  },
};
