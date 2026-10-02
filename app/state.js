// Modèle du formulaire étudiant et conversion vers le DSL du moteur.
// Le formulaire manipule des champs simples (texte, une ligne par point) ;
// toResume() produit le JSON validé par src/dsl/schema.js.

export const LEVELS = ['Natif', 'Courant', 'Professionnel', 'Intermédiaire', 'Notions'];

export function emptyItem() {
  return { title: '', org: '', location: '', period: '', bullets: '' };
}

export function emptyState() {
  return {
    profile: { name: '', title: '', badge: '', email: '', phone: '', location: '', link: '', summary: '' },
    experiences: [emptyItem()],
    education: [emptyItem()],
    skills: [{ label: '', items: '' }],
    languages: [{ name: '', level: '' }],
    interests: '',
  };
}

const t = (s) => (s ?? '').trim();
const lines = (s) => t(s).split('\n').map(t).filter(Boolean);
const commas = (s) => t(s).split(',').map(t).filter(Boolean);
// Retire les champs vides : le DSL ne garde que ce que l'étudiant a saisi.
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));

function items(list) {
  return list
    .filter((i) => t(i.title))
    .map((i) => compact({ title: t(i.title), org: t(i.org), location: t(i.location), period: t(i.period), bullets: lines(i.bullets) }));
}

// placeholderName : nom affiché dans l'aperçu tant que l'étudiant n'a rien saisi.
export function toResume(state, { placeholderName } = {}) {
  const p = state.profile;
  const sections = [];

  const exp = items(state.experiences);
  if (exp.length) sections.push({ type: 'timeline', title: 'Expériences', items: exp });

  const edu = items(state.education);
  if (edu.length) sections.push({ type: 'timeline', title: 'Formation', items: edu });

  const groups = state.skills.map((g) => compact({ label: t(g.label), items: commas(g.items) })).filter((g) => g.items.length);
  if (groups.length) sections.push({ type: 'tags', title: 'Compétences', groups });

  const langs = state.languages.filter((l) => t(l.name)).map((l) => compact({ name: t(l.name), level: t(l.level) }));
  if (langs.length) sections.push({ type: 'list', title: 'Langues', items: langs });

  if (t(state.interests)) sections.push({ type: 'text', title: "Centres d'intérêt", body: t(state.interests) });

  return {
    version: 1,
    template: 'minimal',
    profile: compact({
      name: t(p.name) || placeholderName || '',
      title: t(p.title),
      badge: t(p.badge),
      email: t(p.email),
      phone: t(p.phone),
      location: t(p.location),
      links: t(p.link) ? [{ label: t(p.link) }] : [],
      summary: t(p.summary),
    }),
    sections,
  };
}

// Inverse de toResume, pour charger un CV existant (exemple, brouillon serveur).
export function fromResume(resume) {
  const s = emptyState();
  const p = resume.profile ?? {};
  Object.assign(s.profile, {
    name: p.name ?? '',
    title: p.title ?? '',
    badge: p.badge ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    location: p.location ?? '',
    link: p.links?.[0]?.label ?? '',
    summary: p.summary ?? '',
  });
  const toItems = (list) =>
    list.map((i) => ({ title: i.title ?? '', org: i.org ?? '', location: i.location ?? '', period: i.period ?? '', bullets: (i.bullets ?? []).join('\n') }));

  const timelines = (resume.sections ?? []).filter((x) => x.type === 'timeline');
  const edu = timelines.find((x) => /formation|études|education/i.test(x.title));
  const exp = timelines.find((x) => x !== edu);
  if (exp) s.experiences = toItems(exp.items);
  if (edu) s.education = toItems(edu.items);

  const tags = resume.sections?.find((x) => x.type === 'tags');
  if (tags) s.skills = tags.groups.map((g) => ({ label: g.label ?? '', items: g.items.join(', ') }));

  const list = resume.sections?.find((x) => x.type === 'list');
  if (list) s.languages = list.items.map((l) => ({ name: l.name, level: l.level ?? '' }));

  const text = resume.sections?.find((x) => x.type === 'text');
  if (text) s.interests = text.body;
  return s;
}

// Points à vérifier avant le téléchargement. level : 'ok' | 'warn' | 'todo'.
export function checklist(state, doc) {
  const p = state.profile;
  const hasItems = (list) => list.some((i) => t(i.title));
  return [
    { level: t(p.name) ? 'ok' : 'todo', text: 'Ton nom est renseigné' },
    { level: t(p.email) || t(p.phone) ? 'ok' : 'todo', text: 'Un moyen de te contacter (email ou téléphone)' },
    { level: hasItems(state.experiences) || hasItems(state.education) ? 'ok' : 'todo', text: 'Au moins une expérience ou une formation' },
    { level: t(p.summary) ? 'ok' : 'warn', text: 'Un court résumé en haut du CV (conseillé)' },
    { level: !doc || doc.pages.length === 1 ? 'ok' : 'warn', text: 'Le CV tient sur une page (conseillé)' },
  ];
}
