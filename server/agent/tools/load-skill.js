import { findSkill } from '../skills/index.js';
import { params } from './base.js';
import { store } from '../../store.js';

// Combien de fois chaque skill est chargée (Admin → Skills).
async function count(slug) {
  try {
    const stats = (await store().get('skillStats', {})) ?? {};
    stats[slug] = { loads: (stats[slug]?.loads ?? 0) + 1, lastAt: Date.now() };
    await store().set('skillStats', stats);
  } catch {}
}

export default {
  name: 'load_skill',
  description: 'Charge le contenu complet d’une skill listée dans tes instructions (par son slug), quand la demande y correspond.',
  parameters: params({ slug: { type: 'string' } }, ['slug']),
  async run(run, args) {
    const skill = findSkill(args.slug, { loggedIn: Boolean(run.username) });
    if (!skill) return { error: 'Skill introuvable.' };
    // Une skill coûte des tokens à chaque étape : nombre limité par demande (réglé dans l'admin).
    run.skills ??= [];
    if (!run.skills.includes(skill.slug)) {
      if (Number.isInteger(run.maxSkills) && run.skills.length >= run.maxSkills) return { error: `Limite de ${run.maxSkills} skill(s) par demande atteinte : réponds avec ce que tu as.` };
      run.skills.push(skill.slug);
      (run.skillKinds ??= []).push(skill.kind);
      if (run.countSkills !== false) await count(skill.slug);
    }
    return {
      slug: skill.slug,
      content: skill.content,
      ...(skill.kind === 'knowledge' ? { info: 'Skill de connaissances : sers-t’en pour répondre ; ne modifie le CV que si l’utilisateur le demande.' } : {}),
    };
  },
};
