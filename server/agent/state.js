// Le CV tel que le manipule le formulaire (même forme que app/state.js). Tout ce qui
// vient du client ou du modèle passe par `normalize` : types, longueurs et nombres
// d'éléments bornés, comme dans le DSL (src/dsl/schema.js).

export const LEVELS = ['Natif', 'Courant', 'Professionnel', 'Intermédiaire', 'Notions'];
export const TIMELINES = { education: 'Formation & certifications', experiences: 'Expérience professionnelle' };
export const LISTS = { skills: 'Compétences & certifications', hobbies: 'Loisirs' };

export const LIMITS = {
  name: 80, title: 120, email: 120, phone: 40, address: 160, link: 300, summary: 1200,
  period: 60, itemTitle: 120, org: 120, detail: 400, listItem: 120, langName: 80, langLevel: 40,
};
export const MAX = { phones: 3, timeline: 20, details: 12, skills: 40, hobbies: 40, languages: 20 };

export const text = (value, limit) => String(value ?? '').trim().slice(0, limit);

function strings(values, limit, count) {
  if (typeof values === 'string') values = values.split('\n');
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    const s = text(v, limit);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, count);
}

export function item(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const details = Array.isArray(raw.details) ? raw.details.join('\n') : raw.details;
  return {
    period: text(raw.period, LIMITS.period),
    title: text(raw.title, LIMITS.itemTitle),
    org: text(raw.org, LIMITS.org),
    details: strings(details ?? '', LIMITS.detail, MAX.details).join('\n'),
  };
}

export function language(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return { name: text(raw.name, LIMITS.langName), level: text(raw.level, LIMITS.langLevel) };
}

export function phones(values) {
  return strings(values, LIMITS.phone, MAX.phones);
}

const list = (v, fn, max) => (Array.isArray(v) ? v.slice(0, max).map(fn) : []);

export function normalize(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const p = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
  return {
    profile: {
      name: text(p.name, LIMITS.name),
      title: text(p.title, LIMITS.title),
      email: text(p.email, LIMITS.email),
      phones: phones(p.phones),
      address: text(p.address, LIMITS.address),
      link: text(p.link, LIMITS.link),
      summary: text(p.summary, LIMITS.summary),
    },
    education: list(raw.education, item, MAX.timeline),
    experiences: list(raw.experiences, item, MAX.timeline),
    skills: strings(raw.skills, LIMITS.listItem, MAX.skills),
    languages: list(raw.languages, language, MAX.languages),
    hobbies: strings(raw.hobbies, LIMITS.listItem, MAX.hobbies),
  };
}

const filled = (o) => Object.values(o).some(Boolean);
const withoutEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => (Array.isArray(v) ? v.length : v)));

// Le CV tel que le modèle le voit : blocs vides retirés, index explicites pour les modifier.
export function view(state) {
  const timeline = (key) => state[key].map((it, index) => (filled(it) ? { index, ...withoutEmpty(it) } : null)).filter(Boolean);
  return {
    profile: withoutEmpty(state.profile),
    education: timeline('education'),
    experiences: timeline('experiences'),
    skills: state.skills,
    languages: state.languages.filter((l) => l.name),
    hobbies: state.hobbies,
  };
}

// Retire les blocs entièrement vides (le formulaire en crée un par défaut).
export function compact(state) {
  return {
    ...state,
    education: state.education.filter(filled),
    experiences: state.experiences.filter(filled),
    languages: state.languages.filter((l) => l.name),
  };
}
