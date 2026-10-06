// Les 7 étapes du formulaire, dans l'ordre du CV congolais. Chaque étape
// construit son DOM une fois ; les ajouts et suppressions sont gérés par les
// composants (components.js) sans reconstruire l'étape. `ctx.changed()` met
// l'aperçu à jour ; une étape à liste déclare `ctx.onAdd` pour Ctrl+Entrée.
import { h, field } from './dom.js';
import { itemsInput, choicePills, accordion, photoInput } from './components.js';
import { periodField } from './period.js';
import { emptyItem, emptyLanguage, LEVELS, checklist } from './state.js';

export const STEPS = [
  { id: 'identite', label: 'Identité', render: identity },
  { id: 'profil', label: 'Profil', render: summary },
  { id: 'formation', label: 'Formation', render: (ctx) => timeline(ctx, 'education', EDU) },
  { id: 'experience', label: 'Expérience', render: (ctx) => timeline(ctx, 'experiences', EXP) },
  { id: 'competences', label: 'Compétences', render: skills },
  { id: 'langues', label: 'Langues & loisirs', render: languages },
  { id: 'verification', label: 'Vérification', render: review },
];

const EDU = {
  title: 'Formation & certifications',
  intro: 'Diplômes, formations et certifications. Sur le CV, ils sont classés du plus récent au plus ancien.',
  label: 'FORMATION',
  suggest: ['degrees', 'schools'],
  empty: 'Nouvelle formation',
  add: 'Ajouter une formation',
  fields: { title: ['Diplôme ou certification', 'Licence en réseaux et télécommunications'], org: ['Établissement', 'ENSP, Brazzaville'] },
  details: ['Ce que tu as appris (facultatif)', 'Routage et commutation, adressage IP\nFibre optique, systèmes GSM et 4G'],
};

const EXP = {
  title: 'Expérience professionnelle',
  intro: 'Stages, emplois, bénévolat. Sur le CV, ils sont classés du plus récent au plus ancien.',
  label: 'EXPÉRIENCE',
  suggest: ['jobs', 'companies'],
  empty: 'Nouvelle expérience',
  add: 'Ajouter une expérience',
  fields: { title: ['Poste', 'Stagiaire technicienne réseaux'], org: ['Entreprise ou organisation', 'MTN Congo'] },
  details: ['Tes tâches', 'Installation et câblage de baies réseau\nConfiguration de routeurs Cisco'],
};

function head(title, intro) {
  return h('div', { class: 'step-head' }, h('h2', {}, title), intro && h('p', {}, intro));
}

function identity(ctx) {
  const p = ctx.state.profile;
  const f = (label, key, opts) => field(label, p, key, ctx.changed, opts);
  return h(
    'div',
    { class: 'step' },
    head('Identité et contacts', 'Ce qui apparaît en haut de ton CV.'),
    photoInput({ profile: p, onChange: ctx.changed, shape: ctx.photoShape }),
    f('Nom complet', 'name', { placeholder: 'Grâce Mabiala Nkounkou', autocomplete: 'name' }),
    f('Profession ou domaine', 'title', { placeholder: 'Technicienne en réseaux et télécommunications', suggest: 'jobs' }),
    f('Email', 'email', { placeholder: 'grace.mabiala@gmail.com', type: 'email', autocomplete: 'email' }),
    itemsInput({
      label: 'Téléphones',
      list: p.phones,
      onChange: ctx.changed,
      variant: 'chips',
      max: 3,
      type: 'tel',
      placeholder: '+242 06 612 34 56',
      hint: 'Entrée pour ajouter. Jusqu’à 3 numéros.',
    }),
    f('Adresse', 'address', { placeholder: '12, rue Mbochis, Poto-Poto, Brazzaville' }),
    f('Lien (facultatif)', 'link', { placeholder: 'linkedin.com/in/grace' }),
    h('button', { class: 'btn-link', type: 'button', onClick: ctx.loadExample }, 'Remplir avec un exemple'),
  );
}

function summary(ctx) {
  return h(
    'div',
    { class: 'step' },
    head('Profil professionnel', 'En haut de ton CV : qui tu es, ce que tu sais faire, ce que tu cherches.'),
    field('Ton profil', ctx.state.profile, 'summary', ctx.changed, {
      multiline: true,
      rows: 7,
      placeholder: 'Technicienne en réseaux formée à l’ISTA, avec une expérience pratique en installation de réseaux…',
      hint: '2 à 4 phrases. Va à la ligne pour commencer un nouveau paragraphe.',
    }),
  );
}

// Résumé d'un bloc replié : poste ou diplôme, organisation, période (une ligne chacun).
const timelineSummary = (i) => [
  { text: i.title.trim(), cls: 'acc-title' },
  { text: i.org.trim(), cls: 'acc-org' },
  { text: i.period.trim(), cls: 'acc-period' },
];

function timeline(ctx, key, copy) {
  const list = accordion({
    list: ctx.state[key],
    create: emptyItem,
    label: copy.label,
    empty: copy.empty,
    addLabel: copy.add,
    // Bouton en haut, nouvel élément juste dessous : toujours sous les yeux, sans défiler ni chercher.
    // (Le CV trie de toute façon du plus récent au plus ancien : l'ordre du formulaire ne change rien au rendu.)
    addOnTop: true,
    summary: timelineSummary,
    complete: (i) => Boolean(i.period.trim() && i.title.trim() && i.org.trim()),
    onChange: ctx.changed,
    fields: (item, onInput) => [
      periodField(item, 'period', onInput),
      field(copy.fields.title[0], item, 'title', onInput, { placeholder: copy.fields.title[1], suggest: copy.suggest[0] }),
      field(copy.fields.org[0], item, 'org', onInput, { placeholder: copy.fields.org[1], suggest: copy.suggest[1] }),
      field(copy.details[0], item, 'details', onInput, { multiline: true, rows: 3, placeholder: copy.details[1], hint: 'Une ligne par élément.' }),
    ],
  });
  ctx.onAdd = list.add;
  return h('div', { class: 'step' }, head(copy.title, copy.intro), list.el);
}

function skills(ctx) {
  return h(
    'div',
    { class: 'step' },
    head('Compétences & certifications', 'Tes savoir-faire, outils et certifications, en mots-clés courts.'),
    itemsInput({
      label: 'Compétences',
      list: ctx.state.skills,
      onChange: ctx.changed,
      placeholder: 'Réseaux LAN / WAN',
      suggest: 'skills',
    }),
  );
}

function languages(ctx) {
  const list = accordion({
    list: ctx.state.languages,
    create: emptyLanguage,
    label: 'LANGUE',
    empty: 'Nouvelle langue',
    addLabel: 'Ajouter une langue',
    summary: (l) => [
      { text: l.name.trim(), cls: 'acc-title' },
      { text: l.level, cls: 'acc-org' },
    ],
    complete: (l) => Boolean(l.name.trim() && l.level),
    onChange: ctx.changed,
    fields: (l, onInput, { next }) => [
      field('Langue', l, 'name', onInput, { placeholder: 'Lingala', suggest: 'languages' }),
      choicePills({ label: 'Niveau', options: LEVELS, obj: l, key: 'level', onChange: () => (onInput(), l.level && next()) }),
    ],
  });
  ctx.onAdd = list.add;
  return h(
    'div',
    { class: 'step' },
    head('Langues & loisirs'),
    h('h3', { class: 'sub' }, 'Langues'),
    list.el,
    h('h3', { class: 'sub' }, 'Loisirs'),
    itemsInput({ label: 'Loisirs (facultatif)', list: ctx.state.hobbies, onChange: ctx.changed, variant: 'chips', placeholder: 'Football', suggest: 'hobbies' }),
  );
}

// Vérification en stepper vertical (façon Android) : chaque étape du formulaire, son état
// et ce qu'il reste à faire ; toucher une étape y retourne. Générer reste toujours possible.
// Points à corriger (todo) ou conseillés (warn), avec l'étape où les corriger.
export function reviewIssues(st, doc) {
  const extra = [
    ...(st.skills.length ? [] : [{ level: 'warn', text: 'Ajoute quelques compétences (conseillé)', step: 'competences' }]),
    ...(st.languages.some((l) => l.name.trim()) ? [] : [{ level: 'warn', text: 'Indique au moins une langue (conseillé)', step: 'langues' }]),
  ];
  return [...checklist(st, doc), ...extra].filter((c) => c.level !== 'ok');
}

// Pastille de l'étape Vérification : rouge si un point obligatoire manque, jaune si conseil, vert sinon.
export function reviewStatus(st, doc) {
  const issues = reviewIssues(st, doc);
  const todo = issues.filter((c) => c.level === 'todo').length;
  if (todo) return { level: 'todo', label: todo > 1 ? `${todo} erreurs` : '1 erreur' };
  return issues.length ? { level: 'warn', label: 'À revoir' } : { level: 'ok', label: 'Prêt' };
}

// Niveau de chaque étape du formulaire : { identite: 'todo', profil: 'warn', … } ('ok' si rien à signaler).
export function stepLevels(st, doc) {
  const issues = reviewIssues(st, doc);
  const out = {};
  for (const s of STEPS) {
    const mine = issues.filter((c) => c.step === s.id);
    out[s.id] = mine.some((c) => c.level === 'todo') ? 'todo' : mine.length ? 'warn' : 'ok';
  }
  return out;
}

function review(ctx) {
  const items = checklist(ctx.state, ctx.doc());
  const st = ctx.state;
  const extra = {
    competences: st.skills.length ? [] : [{ level: 'warn', text: 'Ajoute quelques compétences (conseillé)' }],
    langues: st.languages.some((l) => l.name.trim()) ? [] : [{ level: 'warn', text: 'Indique au moins une langue (conseillé)' }],
  };
  const steps = STEPS.filter((s) => s.id !== 'verification').map((s, i) => {
    const issues = [...items.filter((c) => c.step === s.id && c.level !== 'ok'), ...(extra[s.id] ?? [])];
    const level = issues.some((c) => c.level === 'todo') ? 'todo' : issues.length ? 'warn' : 'ok';
    return { ...s, n: i + 1, level, issues };
  });
  const done = steps.filter((s) => s.level === 'ok').length;
  return h(
    'div',
    { class: 'step' },
    head('Vérification', `${done} étape${done > 1 ? 's' : ''} sur ${steps.length} complète${done > 1 ? 's' : ''}. Tu peux générer quand tu veux.`),
    h(
      'ol',
      { class: 'vstepper' },
      steps.map((s) =>
        h(
          'li',
          { class: `vstep ${s.level}` },
          h(
            'button',
            { type: 'button', class: 'vstep-btn', onClick: () => ctx.goToStep(s.id) },
            h('span', { class: 'vstep-dot', 'aria-hidden': 'true' }, s.level === 'ok' ? '✓' : s.level === 'todo' ? '!' : String(s.n)),
            h(
              'span',
              { class: 'vstep-body' },
              h('strong', {}, s.label),
              h('small', {}, s.issues.length ? s.issues.map((c) => c.text).join(' · ') : 'Complet'),
            ),
            h('span', { class: 'vstep-go', 'aria-hidden': 'true' }, '›'),
          ),
        ),
      ),
      h(
        'li',
        { class: 'vstep final' },
        h('span', { class: 'vstep-dot', 'aria-hidden': 'true' }, '↓'),
        h(
          'span',
          { class: 'vstep-body' },
          h('strong', {}, 'Générer ton CV'),
          h('small', {}, 'PDF haute qualité, et Word si tu veux.'),
          h('button', { class: 'btn-primary btn-lg', type: 'button', onClick: ctx.download }, 'Générer mon CV'),
        ),
      ),
    ),
  );
}
