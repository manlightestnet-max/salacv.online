// Skills de l'agent (divulgation progressive) : l'agent ne voit que le CATALOGUE (titre + description) ; quand une
// demande correspond, il charge le contenu (outil load_skill) puis l'applique ou répond avec. Une par fichier dans le
// code, plus celles ajoutées depuis l'admin (stockage), rechargées à chaque requête.
//
// Fiche d'une skill :
//   kind     : « procedure » (peut guider des modifications du CV) ou « knowledge » (connaissances : elle informe
//              les réponses ; chargée seule, elle ne permet pas de modifier le CV sans demande explicite)
//   enabled  : désactivée, elle disparaît du catalogue
//   audience : « all » ou « account » (seulement pour les comptes connectés)
import cvCongolais from './cv-congolais.js';

export const KINDS = ['procedure', 'knowledge'];
export const AUDIENCES = ['all', 'account'];

export function normalizeSkill(s) {
  return {
    slug: String(s?.slug ?? ''),
    title: String(s?.title ?? ''),
    description: String(s?.description ?? ''),
    content: String(s?.content ?? ''),
    kind: KINDS.includes(s?.kind) ? s.kind : 'procedure',
    enabled: s?.enabled !== false,
    audience: AUDIENCES.includes(s?.audience) ? s.audience : 'all',
    ...(s?.updatedAt ? { updatedAt: s.updatedAt } : {}),
  };
}

export const SKILLS = [cvCongolais].map(normalizeSkill);
let extra = [];

export function setExtraSkills(list) {
  extra = (Array.isArray(list) ? list : []).filter((s) => s?.slug && s?.content && !SKILLS.some((b) => b.slug === s.slug)).map(normalizeSkill);
}
export const allSkills = () => [...SKILLS, ...extra];

/** Ce que l'agent peut voir et charger pour cette demande. */
export const visibleSkills = ({ loggedIn = false } = {}) => allSkills().filter((s) => s.enabled && (s.audience === 'all' || loggedIn));
export const findSkill = (slug, opts) => visibleSkills(opts).find((s) => s.slug === slug) ?? null;
