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
  empty: 'Nouvelle formation',
  add: 'Ajouter une formation',
  fields: { title: ['Diplôme ou certification', 'Licence en réseaux et télécommunications'], org: ['Établissement', 'ISTA Kinshasa'] },
  details: ['Ce que tu as appris (facultatif)', 'Routage et commutation, adressage IP\nFibre optique, systèmes GSM et 4G'],
};

const EXP = {
  title: 'Expérience professionnelle',
  intro: 'Stages, emplois, bénévolat. Sur le CV, ils sont classés du plus récent au plus ancien.',
  label: 'EXPÉRIENCE',
  empty: 'Nouvelle expérience',
  add: 'Ajouter une expérience',
  fields: { title: ['Poste', 'Stagiaire technicienne réseaux'], org: ['Entreprise ou organisation', 'Vodacom Congo'] },
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
    f('Nom complet', 'name', { placeholder: 'Grâce Mbuyi Kalala', autocomplete: 'name' }),
    f('Profession ou domaine', 'title', { placeholder: 'Technicienne en réseaux et télécommunications' }),
    f('Email', 'email', { placeholder: 'grace.mbuyi@gmail.com', type: 'email', autocomplete: 'email' }),
    itemsInput({
      label: 'Téléphones',
      list: p.phones,
      onChange: ctx.changed,
      variant: 'chips',
      max: 3,
      type: 'tel',
      placeholder: '+243 81 234 5678',
      hint: 'Entrée pour ajouter. Jusqu’à 3 numéros.',
    }),
    f('Adresse', 'address', { placeholder: '12, av. Kasa-Vubu, Q/Matonge, C/Kalamu, Kinshasa' }),
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

// Résumé d'un bloc replié, au format du CV : "2023 — 2026 | Licence — ISTA".
const timelineSummary = (i) => [
  { text: i.period.trim(), cls: 'acc-period' },
  { text: i.title.trim(), cls: 'acc-title' },
  { text: i.org.trim() && `— ${i.org.trim()}`, cls: 'acc-org' },
];

function timeline(ctx, key, copy) {
  const list = accordion({
    list: ctx.state[key],
    create: emptyItem,
    label: copy.label,
    empty: copy.empty,
    addLabel: copy.add,
    summary: timelineSummary,
    onChange: ctx.changed,
    fields: (item, onInput) => [
      periodField(item, 'period', onInput),
      field(copy.fields.title[0], item, 'title', onInput, { placeholder: copy.fields.title[1] }),
      field(copy.fields.org[0], item, 'org', onInput, { placeholder: copy.fields.org[1] }),
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
      { text: l.level && `— ${l.level}`, cls: 'acc-org' },
    ],
    onChange: ctx.changed,
    fields: (l, onInput) => [
      field('Langue', l, 'name', onInput, { placeholder: 'Lingala' }),
      choicePills({ label: 'Niveau', options: LEVELS, obj: l, key: 'level', onChange: onInput }),
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
    itemsInput({ label: 'Loisirs (facultatif)', list: ctx.state.hobbies, onChange: ctx.changed, variant: 'chips', placeholder: 'Football' }),
  );
}

function review(ctx) {
  const items = checklist(ctx.state, ctx.doc());
  const blocking = items.some((i) => i.level === 'todo');
  return h(
    'div',
    { class: 'step' },
    head('Vérification', 'Un dernier coup d’œil avant de préparer ton CV.'),
    h(
      'ul',
      { class: 'checks' },
      items.map((i) =>
        h(
          'li',
          {},
          h(
            'button',
            { class: `check ${i.level}`, type: 'button', onClick: () => ctx.goToStep(i.step) },
            h('span', { class: 'check-icon' }, i.level === 'ok' ? '✓' : '!'),
            h('span', { class: 'check-text' }, i.text),
            h('span', { class: 'check-go', 'aria-hidden': 'true' }, '›'),
          ),
        ),
      ),
    ),
    h('button', { class: 'btn-primary btn-lg', type: 'button', disabled: blocking, onClick: ctx.download }, 'Préparer mon CV'),
    blocking && h('p', { class: 'hint' }, 'Complète les points marqués ! pour pouvoir préparer ton CV.'),
  );
}
