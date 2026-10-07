import { findSkill } from '../skills/index.js';
import { params } from './base.js';

export default {
  name: 'load_skill',
  description: 'Charge le contenu complet d’une skill listée dans tes instructions (par son slug), quand la demande y correspond.',
  parameters: params({ slug: { type: 'string' } }, ['slug']),
  run(run, args) {
    const skill = findSkill(args.slug);
    if (!skill) return { error: 'Skill introuvable.' };
    // Une skill coûte des tokens à chaque étape : nombre limité par demande (réglé dans l'admin).
    run.skills ??= [];
    if (!run.skills.includes(skill.slug)) {
      if (Number.isInteger(run.maxSkills) && run.skills.length >= run.maxSkills) return { error: `Limite de ${run.maxSkills} skill(s) par demande atteinte : réponds avec ce que tu as.` };
      run.skills.push(skill.slug);
    }
    return { slug: skill.slug, content: skill.content };
  },
};
