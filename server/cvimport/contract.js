// Contrat de l'import de CV : ce que l'IA renvoie (CV candidat), puis la forme canonique du studio.
//   CV candidat : la réponse de l'IA, tolérante (chaînes ou listes, champs manquants) + les chemins qu'elle juge
//                 incertains. Rien n'en sort sans passer par `normalize` (types, longueurs, nombres bornés).
//   CV canonique : l'état du studio (server/agent/state.js), indépendant du modèle de présentation.
import { z } from 'zod';
import { normalize } from '../agent/state.js';

const str = z.preprocess((v) => (v == null ? '' : typeof v === 'number' ? String(v) : v), z.string()).catch('');
const strList = z.preprocess((v) => (typeof v === 'string' ? v.split(/\n|;/) : v ?? []), z.array(str)).catch([]);
const entry = z
  .object({ title: str, org: str, period: str, details: z.preprocess((v) => (typeof v === 'string' ? v.split('\n') : v ?? []), z.array(str)).catch([]) })
  .partial()
  .catch({});

export const CandidateSchema = z
  .object({
    profile: z.object({ name: str, title: str, email: str, phones: strList, address: str, link: str, summary: str }).partial().catch({}),
    education: z.array(entry).catch([]),
    experiences: z.array(entry).catch([]),
    skills: strList,
    languages: z.array(z.object({ name: str, level: str }).partial().catch({})).catch([]),
    hobbies: strList,
    uncertain: z.array(z.string()).catch([]),
  })
  .partial();

/** Réponse de l'IA (texte) → objet JSON. Accepte un bloc ```json … ``` ou du texte autour. → objet | null */
export function parseJson(text) {
  const s = String(text ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  try {
    const v = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** CV candidat (objet de l'IA) → { state (canonique), aiUncertain (chemins) } */
export function toCandidate(raw) {
  const c = CandidateSchema.parse(raw ?? {});
  const joinDetails = (e) => ({ ...e, details: (e.details ?? []).join('\n') });
  const state = normalize({
    profile: c.profile ?? {},
    education: (c.education ?? []).map(joinDetails),
    experiences: (c.experiences ?? []).map(joinDetails),
    skills: c.skills ?? [],
    languages: c.languages ?? [],
    hobbies: c.hobbies ?? [],
  });
  const PATH = /^(profile\.(name|title|email|address|link|summary|phones\.\d+)|(education|experiences)\.\d+\.(title|org|period|details(\.\d+)?)|(skills|hobbies)\.\d+|languages\.\d+\.(name|level))$/;
  return { state, aiUncertain: [...new Set((c.uncertain ?? []).filter((p) => PATH.test(p)))] };
}

/** Tous les chemins des valeurs remplies d'un état canonique, avec leur valeur. → [[chemin, valeur]] */
export function fields(state) {
  const out = [];
  const p = state.profile;
  for (const k of ['name', 'title', 'email', 'address', 'link', 'summary']) if (p[k]) out.push([`profile.${k}`, p[k]]);
  p.phones.forEach((v, i) => out.push([`profile.phones.${i}`, v]));
  for (const key of ['education', 'experiences']) {
    state[key].forEach((it, i) => {
      for (const k of ['title', 'org', 'period']) if (it[k]) out.push([`${key}.${i}.${k}`, it[k]]);
      it.details
        .split('\n')
        .filter(Boolean)
        .forEach((d, j) => out.push([`${key}.${i}.details.${j}`, d]));
    });
  }
  state.skills.forEach((v, i) => out.push([`skills.${i}`, v]));
  state.hobbies.forEach((v, i) => out.push([`hobbies.${i}`, v]));
  state.languages.forEach((l, i) => {
    if (l.name) out.push([`languages.${i}.name`, l.name]);
    if (l.level) out.push([`languages.${i}.level`, l.level]);
  });
  return out;
}
