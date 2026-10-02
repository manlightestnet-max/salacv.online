// Skills de l'agent : une par fichier, chargées à la demande (outil load_skill).
import cvCongolais from './cv-congolais.js';

export const SKILLS = [cvCongolais];
export const findSkill = (slug) => SKILLS.find((s) => s.slug === slug) ?? null;
