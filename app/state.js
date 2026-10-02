// Modèle du formulaire étudiant et conversion vers le DSL du moteur.
// Format CV congolais : identité + contacts, profil professionnel, formation &
// certifications, expérience professionnelle, compétences, langues, loisirs.

export const LEVELS = ['Natif', 'Courant', 'Professionnel', 'Intermédiaire', 'Notions'];

export const SECTION_TITLES = {
  education: 'Formation & certifications',
  experiences: 'Expérience professionnelle',
  skills: 'Compétences & certifications',
  languages: 'Langues',
  hobbies: 'Loisirs',
};

export function emptyItem() {
  return { period: '', title: '', org: '', details: '' };
}

export function emptyState() {
  return {
    profile: { name: '', title: '', email: '', phones: [''], address: '', link: '', summary: '' },
    education: [emptyItem()],
    experiences: [emptyItem()],
    skills: '',
    languages: [{ name: '', level: '' }],
    hobbies: '',
  };
}

const t = (s) => (s ?? '').trim();
const lines = (s) => t(s).split('\n').map(t).filter(Boolean);
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
  const mock = (title) => mockup?.sections?.find((x) => x.title === title);
  const push = (section, title) => {
    if (section) sections.push(section);
    else if (mock(title)) sections.push({ ...mock(title), ghost: true });
  };

  const edu = timeline(state.education);
  push(edu.length && { type: 'timeline', title: SECTION_TITLES.education, items: edu }, SECTION_TITLES.education);

  const exp = timeline(state.experiences);
  push(exp.length && { type: 'timeline', title: SECTION_TITLES.experiences, items: exp }, SECTION_TITLES.experiences);

  const skills = lines(state.skills);
  push(skills.length && { type: 'bullets', title: SECTION_TITLES.skills, items: skills }, SECTION_TITLES.skills);

  const langs = state.languages.filter((l) => t(l.name)).map((l) => compact({ name: t(l.name), level: t(l.level) }));
  push(langs.length && { type: 'list', title: SECTION_TITLES.languages, items: langs }, SECTION_TITLES.languages);

  const hobbies = lines(state.hobbies);
  push(hobbies.length && { type: 'bullets', title: SECTION_TITLES.hobbies, items: hobbies }, SECTION_TITLES.hobbies);

  const profile = compact({
    name: t(p.name),
    title: t(p.title),
    email: t(p.email),
    phones: p.phones.map(t).filter(Boolean),
    address: t(p.address),
    links: t(p.link) ? [{ label: t(p.link) }] : [],
    summary: lines(p.summary).join('\n'),
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

  return { version: 1, template: 'minimal', profile, sections };
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
    phones: p.phones?.length ? [...p.phones] : [''],
    address: p.address ?? '',
    link: p.links?.[0]?.label ?? '',
    summary: p.summary ?? '',
  });
  const byTitle = (title) => (resume.sections ?? []).find((x) => x.title === title);
  const toItems = (sec) => sec?.items.map((i) => ({ period: i.period ?? '', title: i.title ?? '', org: i.org ?? '', details: (i.bullets ?? []).join('\n') }));

  s.education = toItems(byTitle(SECTION_TITLES.education)) ?? s.education;
  s.experiences = toItems(byTitle(SECTION_TITLES.experiences)) ?? s.experiences;
  s.skills = byTitle(SECTION_TITLES.skills)?.items.join('\n') ?? '';
  const langs = byTitle(SECTION_TITLES.languages);
  if (langs) s.languages = langs.items.map((l) => ({ name: l.name, level: l.level ?? '' }));
  s.hobbies = byTitle(SECTION_TITLES.hobbies)?.items.join('\n') ?? '';
  return s;
}

// Points à vérifier avant le téléchargement. level : 'ok' | 'warn' | 'todo'.
export function checklist(state, doc) {
  const p = state.profile;
  const hasItems = (list) => list.some((i) => t(i.title));
  return [
    { level: t(p.name) ? 'ok' : 'todo', text: 'Ton nom est renseigné' },
    { level: t(p.title) ? 'ok' : 'todo', text: 'Ta profession ou ton domaine' },
    { level: t(p.email) || p.phones.some(t) ? 'ok' : 'todo', text: 'Un moyen de te contacter (email ou téléphone)' },
    { level: hasItems(state.education) ? 'ok' : 'todo', text: 'Au moins une formation' },
    { level: t(p.summary) ? 'ok' : 'warn', text: 'Un profil professionnel (conseillé)' },
    { level: !doc || doc.pages.length === 1 ? 'ok' : 'warn', text: 'Le CV tient sur une page (conseillé)' },
  ];
}
