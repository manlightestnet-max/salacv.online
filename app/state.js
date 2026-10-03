// Modèle du formulaire étudiant et conversion vers le DSL du moteur.
// Format CV congolais : identité + contacts, profil professionnel, formation &
// certifications, expérience professionnelle, compétences, langues, loisirs.
import { DEFAULT_LANG, LANGS, label } from '../src/i18n/index.js';

export const LEVELS = ['Natif', 'Courant', 'Professionnel', 'Intermédiaire', 'Notions'];

export const SECTION_TITLES = {
  education: 'Formation & certifications',
  experiences: 'Expérience professionnelle',
  skills: 'Compétences & certifications',
  languages: 'Langues',
  hobbies: 'Loisirs',
};
const SECTION_KEYS = Object.keys(SECTION_TITLES);

// Titres des sections dans la langue du CV (tableau i18n/cv.csv).
export const sectionTitle = (lang, key) => label(lang, `section.${key}`);
// Niveau de langue : saisi en français (pastilles), affiché dans la langue du CV.
const levelIn = (lang, level) => (LEVELS.includes(level) ? label(lang, `level.${level}`) : level);

export function emptyItem() {
  return { period: '', title: '', org: '', details: '' };
}

export function emptyLanguage() {
  return { name: '', level: '' };
}

export const TEMPLATES = [
  { id: 'minimal', name: 'Minimal' },
  { id: 'bandeau', name: 'Bandeau' },
  { id: 'vitae', name: 'Vitae' },
  { id: 'diagonale', name: 'Diagonale' },
  { id: 'epure', name: 'Épuré' },
  { id: 'marine', name: 'Marine' },
  { id: 'contraste', name: 'Contraste' },
  { id: 'classique', name: 'Classique' },
  { id: 'cursus', name: 'Cursus' },
  { id: 'encadre', name: 'Encadré' },
  { id: 'sobre', name: 'Sobre' },
  { id: 'cahier', name: 'Cahier' },
];
const PHOTO = /^data:image\/(jpeg|png);base64,/;

export function emptyState() {
  return {
    lang: DEFAULT_LANG,
    template: 'minimal',
    profile: { name: '', title: '', email: '', phones: [], address: '', link: '', summary: '', photo: '' },
    education: [emptyItem()],
    experiences: [emptyItem()],
    skills: [],
    languages: [emptyLanguage()],
    hobbies: [],
  };
}

const t = (s) => (s ?? '').trim();
const lines = (s) => t(s).split('\n').map(t).filter(Boolean);
const list = (a) => (Array.isArray(a) ? a : lines(a)).map(t).filter(Boolean);

// Complète un brouillon enregistré (anciennes versions : compétences et loisirs
// en texte, une ligne par élément) pour qu'il ait la forme actuelle.
export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  Object.assign(s.profile, raw.profile ?? {});
  s.profile.phones = list(s.profile.phones);
  if (!PHOTO.test(s.profile.photo ?? '')) s.profile.photo = '';
  if (TEMPLATES.some((t) => t.id === raw.template)) s.template = raw.template;
  if (LANGS.includes(raw.lang)) s.lang = raw.lang;
  for (const key of ['education', 'experiences', 'languages']) if (Array.isArray(raw[key])) s[key] = raw[key];
  s.skills = list(raw.skills);
  s.hobbies = list(raw.hobbies);
  return s;
}
// Retire les champs vides : le DSL ne garde que ce que l'étudiant a saisi.
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));

const ONGOING = /aujourd|présent|actuel|en cours|now/i;

// Clé de tri d'une période ("2023 — 2026", "Juin — Sept. 2025", "2024 — aujourd'hui") :
// [année de fin, année de début], "en cours" passe en premier, sans date à la fin.
export function periodKey(period) {
  const years = (t(period).match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  if (!years.length && !ONGOING.test(period)) return [-1, -1];
  const end = ONGOING.test(period) ? 9999 : Math.max(...years);
  return [end, years.length ? Math.min(...years) : end];
}

// Du plus récent au plus ancien ; l'ordre de saisie départage les égalités.
export function sortRecentFirst(items) {
  return items
    .map((item, i) => ({ item, i, k: periodKey(item.period) }))
    .sort((a, b) => b.k[0] - a.k[0] || b.k[1] - a.k[1] || a.i - b.i)
    .map((x) => x.item);
}

function timeline(list) {
  return sortRecentFirst(list.filter((i) => t(i.title))).map((i) =>
    compact({ title: t(i.title), org: t(i.org), period: t(i.period), bullets: lines(i.details) }),
  );
}

// mockup : CV d'exemple (DSL). Dans l'aperçu, chaque partie que l'étudiant
// n'a pas encore remplie est prise dans l'exemple et marquée `ghost` (grisée),
// pour qu'il voie tout de suite le format. Jamais utilisé pour le PDF.
export function toResume(state, { mockup } = {}) {
  const p = state.profile;
  const sections = [];
  const lang = state.lang ?? DEFAULT_LANG;
  const T = Object.fromEntries(SECTION_KEYS.map((k) => [k, sectionTitle(lang, k)]));
  // Exemple (en français) : on le reconnaît par son titre français, on l'affiche sous le titre de la langue.
  const mock = (title) => {
    const key = SECTION_KEYS.find((k) => T[k] === title);
    const m = mockup?.sections?.find((x) => x.title === SECTION_TITLES[key]);
    return m && { ...m, title };
  };
  const push = (section, title) => {
    if (section) sections.push(section);
    else if (mock(title)) sections.push({ ...mock(title), ghost: true });
  };

  const edu = timeline(state.education);
  push(edu.length && { type: 'timeline', title: T.education, items: edu }, T.education);

  const exp = timeline(state.experiences);
  push(exp.length && { type: 'timeline', title: T.experiences, items: exp }, T.experiences);

  const skills = list(state.skills);
  push(skills.length && { type: 'bullets', title: T.skills, items: skills }, T.skills);

  const langs = state.languages.filter((l) => t(l.name)).map((l) => compact({ name: t(l.name), level: levelIn(lang, t(l.level)) }));
  push(langs.length && { type: 'list', title: T.languages, items: langs }, T.languages);

  const hobbies = list(state.hobbies);
  push(hobbies.length && { type: 'bullets', title: T.hobbies, items: hobbies }, T.hobbies);

  const profile = compact({
    name: t(p.name),
    title: t(p.title),
    email: t(p.email),
    phones: list(p.phones),
    address: t(p.address),
    links: t(p.link) ? [{ label: t(p.link) }] : [],
    summary: lines(p.summary).join('\n'),
    photo: PHOTO.test(p.photo ?? '') ? p.photo : '',
  });

  if (mockup) {
    const m = mockup.profile;
    const ghost = [];
    for (const key of ['name', 'title', 'summary']) {
      if (!profile[key] && m[key]) {
        profile[key] = m[key];
        ghost.push(key);
      }
    }
    if (!profile.email && !profile.phones.length && !profile.address) {
      Object.assign(profile, compact({ email: m.email ?? '', phones: m.phones ?? [], address: m.address ?? '' }));
      ghost.push('contact');
    }
    profile.ghost = ghost;
  }

  const template = TEMPLATES.some((t) => t.id === state.template) ? state.template : 'minimal';
  return { version: 1, template, lang, profile, sections };
}

// Vrai si l'aperçu montre encore des parties de l'exemple.
export function hasGhost(resume) {
  return Boolean(resume.profile.ghost?.length || resume.sections.some((s) => s.ghost));
}

// Inverse de toResume, pour charger un CV existant (exemple, brouillon serveur).
export function fromResume(resume) {
  const s = emptyState();
  const p = resume.profile ?? {};
  Object.assign(s.profile, {
    name: p.name ?? '',
    title: p.title ?? '',
    email: p.email ?? '',
    phones: [...(p.phones ?? [])],
    address: p.address ?? '',
    link: p.links?.[0]?.label ?? '',
    summary: p.summary ?? '',
    photo: p.photo ?? '',
  });
  if (TEMPLATES.some((t) => t.id === resume.template)) s.template = resume.template;
  if (LANGS.includes(resume.lang)) s.lang = resume.lang;
  // Section reconnue par son titre dans n'importe quelle langue du tableau.
  const byTitle = (title) => {
    const key = SECTION_KEYS.find((k) => SECTION_TITLES[k] === title);
    const titles = new Set(LANGS.map((l) => sectionTitle(l, key)));
    return (resume.sections ?? []).find((x) => titles.has(x.title));
  };
  const toItems = (sec) => sec?.items.map((i) => ({ period: i.period ?? '', title: i.title ?? '', org: i.org ?? '', details: (i.bullets ?? []).join('\n') }));

  s.education = toItems(byTitle(SECTION_TITLES.education)) ?? s.education;
  s.experiences = toItems(byTitle(SECTION_TITLES.experiences)) ?? s.experiences;
  s.skills = [...(byTitle(SECTION_TITLES.skills)?.items ?? [])];
  const langs = byTitle(SECTION_TITLES.languages);
  // Niveau affiché dans une autre langue (« Fluent ») : on retrouve la pastille française.
  const frLevel = (v) => LEVELS.find((fr) => LANGS.some((l) => label(l, `level.${fr}`) === v)) ?? v ?? '';
  if (langs) s.languages = langs.items.map((l) => ({ name: l.name, level: frLevel(l.level) }));
  s.hobbies = [...(byTitle(SECTION_TITLES.hobbies)?.items ?? [])];
  return s;
}

// Points à vérifier avant le téléchargement. level : 'ok' | 'warn' | 'todo'.
export function checklist(state, doc) {
  const p = state.profile;
  const hasItems = (list) => list.some((i) => t(i.title));
  // step : étape du formulaire où corriger le point.
  return [
    { level: t(p.name) ? 'ok' : 'todo', text: 'Ton nom est renseigné', step: 'identite' },
    { level: t(p.title) ? 'ok' : 'todo', text: 'Ta profession ou ton domaine', step: 'identite' },
    { level: t(p.email) || p.phones.some(t) ? 'ok' : 'todo', text: 'Un moyen de te contacter (email ou téléphone)', step: 'identite' },
    { level: hasItems(state.education) ? 'ok' : 'todo', text: 'Au moins une formation', step: 'formation' },
    { level: t(p.summary) ? 'ok' : 'warn', text: 'Un profil professionnel (conseillé)', step: 'profil' },
    { level: !doc || doc.pages.length === 1 ? 'ok' : 'warn', text: 'Le CV tient sur une page (conseillé)', step: 'experience' },
  ];
}
