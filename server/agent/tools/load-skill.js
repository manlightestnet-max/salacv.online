import { findSkill } from '../skills/index.js';
import { params } from './base.js';

export default {
  name: 'load_skill',
  description: 'Charge le contenu complet d’une skill listée dans tes instructions (par son slug), quand la demande y correspond.',
  parameters: params({ slug: { type: 'string' } }, ['slug']),
  run(run, args) {
    const skill = findSkill(args.slug);
    return skill ? { slug: skill.slug, content: skill.content } : { error: 'Skill introuvable.' };
  },
};
