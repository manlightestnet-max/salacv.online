// Vérifications du CV candidat, sans IA (gratuites) :
//   correspondance : chaque valeur extraite est cherchée dans le texte du PDF. Trouvée = sûre ; absente = à vérifier.
//                    (Sans texte : photo ou scan, on ne peut pas prouver ; seuls les doutes de l'IA et les formats comptent.)
//   sémantique     : e-mail, téléphone, périodes, doublons, champs essentiels manquants.
import { fields } from './contract.js';

export const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.+]+/g, ' ')
    .trim();
const words = (s) => fold(s).split(' ').filter((w) => w.length >= 3);
const digits = (s) => String(s ?? '').replace(/\D/g, '');

// Ce qui n'a pas besoin d'être prouvé mot pour mot : niveaux de langue (souvent reformulés : « courant », « C1 »…).
const LOOSE = /^languages\.\d+\.level$/;

/** → Set des chemins NON retrouvés dans le texte source (null si pas de texte : rien à prouver). */
export function unmatched(state, sourceText) {
  const src = fold(sourceText);
  if (src.length < 40) return null; // pas de couche texte exploitable (scan, photo)
  const srcDigits = digits(sourceText);
  const srcWords = new Set(words(sourceText));
  const missing = new Set();
  for (const [path, value] of fields(state)) {
    if (LOOSE.test(path)) continue;
    if (/^profile\.phones\.\d+$/.test(path)) {
      const d = digits(value).slice(-8); // sans indicatif : « 06 612 34 56 » = « +242066123456 »
      if (d.length < 6 || !srcDigits.includes(d)) missing.add(path);
      continue;
    }
    const v = fold(value);
    if (!v) continue;
    if (v.length <= 60 && src.includes(v)) continue;
    // Phrases (missions, profil) : la plupart de leurs mots doivent être dans le document.
    const w = words(value);
    const found = w.filter((x) => srcWords.has(x)).length;
    if (w.length && found / w.length >= (v.length > 60 ? 0.75 : 0.9)) continue;
    missing.add(path);
  }
  return missing;
}

const YEAR = /\b(19[5-9]\d|20\d\d)\b/g;
const NOW = /(en cours|aujourd|actuel|present|now|today|ce jour)/i;

/** → [{ path, kind, message }] */
export function semanticIssues(state, { now = new Date() } = {}) {
  const issues = [];
  const add = (path, kind, message) => issues.push({ path, kind, message });
  const p = state.profile;
  const thisYear = now.getFullYear();
  if (!p.name) add('profile.name', 'missing', 'Nom absent : il est obligatoire sur le CV.');
  if (p.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(p.email)) add('profile.email', 'format', 'E-mail au format inhabituel.');
  p.phones.forEach((ph, i) => {
    const d = digits(ph);
    if (d.length < 8 || d.length > 15) add(`profile.phones.${i}`, 'format', 'Numéro de téléphone incomplet ou trop long.');
  });
  for (const key of ['education', 'experiences']) {
    const seen = new Map();
    state[key].forEach((it, i) => {
      if (!it.title && (it.org || it.period)) add(`${key}.${i}.title`, 'missing', key === 'education' ? 'Diplôme ou formation sans intitulé.' : 'Expérience sans intitulé de poste.');
      const years = (it.period.match(YEAR) ?? []).map(Number);
      if (years.some((y) => y > thisYear + 6)) add(`${key}.${i}.period`, 'date', 'Année dans le futur lointain : à vérifier.');
      if (years.length >= 2 && years[1] < years[0]) add(`${key}.${i}.period`, 'date', 'La fin est avant le début.');
      if (key === 'experiences' && years.length === 1 && years[0] > thisYear && !NOW.test(it.period)) add(`${key}.${i}.period`, 'date', 'Expérience qui commence dans le futur.');
      const k = `${fold(it.title)}|${fold(it.org)}`;
      if (it.title && seen.has(k)) add(`${key}.${i}`, 'duplicate', 'En double avec une autre entrée.');
      seen.set(k, i);
    });
  }
  return issues;
}

/**
 * Le CV candidat prêt pour l'écran « Vérifie ce que j'ai lu ».
 * → { state, verify: [chemins à vérifier], issues, proven (bool : une couche texte a servi de preuve), counts }
 */
export function review(state, { sourceText = '', aiUncertain = [], now } = {}) {
  const missing = unmatched(state, sourceText);
  const issues = semanticIssues(state, { now });
  const verify = new Set(aiUncertain);
  if (missing) for (const p of missing) verify.add(p);
  for (const i of issues) if (i.kind !== 'missing') verify.add(i.path);
  const total = fields(state).length;
  return { state, verify: [...verify].sort(), issues, proven: missing !== null, counts: { fields: total, verify: verify.size } };
}
