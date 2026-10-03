// Skills de l'agent : une par fichier, chargées à la demande (outil load_skill), plus celles
// ajoutées depuis l'admin (stockage), rechargées à chaque requête.
import cvCongolais from './cv-congolais.js';

export const SKILLS = [cvCongolais];
let extra = [];

export function setExtraSkills(list) {
  extra = (Array.isArray(list) ? list : []).filter((s) => s?.slug && s?.content && !SKILLS.some((b) => b.slug === s.slug));
}
export const allSkills = () => [...SKILLS, ...extra];
export const findSkill = (slug) => allSkills().find((s) => s.slug === slug) ?? null;
