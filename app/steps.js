// Les 6 étapes du formulaire, dans l'ordre du CV congolais. Chaque étape
// construit son DOM à partir de l'état ; `ctx.changed()` met l'aperçu à jour,
// `ctx.rerender()` reconstruit l'étape après un ajout ou une suppression.
import { h, field } from './dom.js';
import { emptyItem, LEVELS, checklist } from './state.js';

export const STEPS = [
  { id: 'identite', label: 'Identité', render: identity },
  { id: 'profil', label: 'Profil', render: summary },
  { id: 'formation', label: 'Formation', render: (ctx) => timeline(ctx, 'education', EDU), add: (s) => s.education.push(emptyItem()) },
  { id: 'experience', label: 'Expérience', render: (ctx) => timeline(ctx, 'experiences', EXP), add: (s) => s.experiences.push(emptyItem()) },
  { id: 'competences', label: 'Compétences', render: skills, add: (s) => s.languages.push({ name: '', level: '' }) },
  { id: 'verification', label: 'Vérification', render: review },
];

const EDU = {
  title: 'Formation & certifications',
  intro: 'Diplômes, formations et certifications. Classés automatiquement du plus récent au plus ancien.',
  item: 'Formation',
  add: 'Ajouter une formation',
  fields: { title: ['Diplôme ou certification', 'Licence en réseaux et télécommunications'], org: ['Établissement', 'ISTA Kinshasa'] },
  details: ['Ce que tu as appris (facultatif)', 'Routage et commutation, adressage IP\nFibre optique, systèmes GSM et 4G'],
};

const EXP = {
  title: 'Expérience professionnelle',
  intro: 'Stages, emplois, bénévolat. Classés automatiquement du plus récent au plus ancien.',
  item: 'Expérience',
  add: 'Ajouter une expérience',
  fields: { title: ['Poste', 'Stagiaire technicienne réseaux'], org: ['Entreprise ou organisation', 'Vodacom Congo'] },
  details: ['Tes tâches', 'Installation et câblage de baies réseau\nConfiguration de routeurs Cisco'],
};

function head(title, intro) {
  return h('div', { class: 'step-head' }, h('h2', {}, title), intro && h('p', {}, intro));
}

function removeButton(onClick, label = 'Supprimer') {
  return h('button', { class: 'icon-btn danger', type: 'button', title: label, 'aria-label': label, onClick }, '✕');
}

function identity(ctx) {
  const p = ctx.state.profile;
  const f = (label, key, opts) => field(label, p, key, ctx.changed, opts);

  const phones = p.phones.map((_, i) =>
    h(
      'div',
      { class: 'row' },
      field(i ? `Téléphone ${i + 1}` : 'Téléphone', p.phones, i, ctx.changed, { placeholder: '+243 81 234 5678', type: 'tel' }),
      p.phones.length > 1 && removeButton(() => {
        p.phones.splice(i, 1);
        ctx.rerender();
      }),
    ),
  );

  return h(
    'div',
    { class: 'step' },
    head('Identité et contacts', 'Ce qui apparaît en haut de ton CV.'),
    f('Nom complet', 'name', { placeholder: 'Grâce Mbuyi Kalala', autocomplete: 'name' }),
    f('Profession ou domaine', 'title', { placeholder: 'Technicienne en réseaux et télécommunications' }),
    f('Email', 'email', { placeholder: 'grace.mbuyi@gmail.com', type: 'email', autocomplete: 'email' }),
    phones,
    p.phones.length < 3 &&
      h('button', {
        class: 'btn-add',
        type: 'button',
        onClick: () => {
          p.phones.push('');
          ctx.rerender();
        },
      }, '+ Ajouter un numéro'),
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

function timeline(ctx, key, copy) {
  const list = ctx.state[key];
  const cards = list.map((item, i) =>
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h('span', { class: 'card-label' }, `${copy.item.toUpperCase()} ${String(i + 1).padStart(2, '0')}`),
        removeButton(() => {
          list.splice(i, 1);
          ctx.rerender();
        }),
      ),
      field('Période', item, 'period', ctx.changed, { placeholder: '2024 — 2025' }),
      field(copy.fields.title[0], item, 'title', ctx.changed, { placeholder: copy.fields.title[1] }),
      field(copy.fields.org[0], item, 'org', ctx.changed, { placeholder: copy.fields.org[1] }),
      field(copy.details[0], item, 'details', ctx.changed, { multiline: true, rows: 3, placeholder: copy.details[1], hint: 'Une ligne par élément.' }),
    ),
  );
  return h('div', { class: 'step' }, head(copy.title, copy.intro), cards, addButton(ctx, copy.add));
}

function addButton(ctx, label) {
  return h('button', { class: 'btn-add', type: 'button', onClick: ctx.addItem }, `+ ${label}`, h('kbd', {}, 'Ctrl ↵'));
}

function skills(ctx) {
  const s = ctx.state;
  const langs = s.languages.map((l, i) =>
    h(
      'div',
      { class: 'row' },
      field('Langue', l, 'name', ctx.changed, { placeholder: 'Lingala' }),
      field('Niveau', l, 'level', ctx.changed, { placeholder: 'Natif', list: 'levels' }),
      removeButton(() => {
        s.languages.splice(i, 1);
        ctx.rerender();
      }),
    ),
  );

  return h(
    'div',
    { class: 'step' },
    head('Compétences, langues et loisirs'),
    field('Compétences & certifications', s, 'skills', ctx.changed, {
      multiline: true,
      rows: 6,
      placeholder: 'Réseaux LAN / WAN\nFibre optique\nMicrosoft Office (Word, Excel)\nAnglais technique',
      hint: 'Une compétence par ligne.',
    }),
    h('h3', { class: 'sub' }, 'Langues'),
    h('datalist', { id: 'levels' }, LEVELS.map((v) => h('option', { value: v }))),
    langs,
    addButton(ctx, 'Ajouter une langue'),
    h('h3', { class: 'sub' }, 'Loisirs'),
    field('Loisirs (facultatif)', s, 'hobbies', ctx.changed, { multiline: true, rows: 3, placeholder: 'Football\nLecture\nMusique', hint: 'Un loisir par ligne.' }),
  );
}

function review(ctx) {
  const items = checklist(ctx.state, ctx.doc());
  const blocking = items.some((i) => i.level === 'todo');
  return h(
    'div',
    { class: 'step' },
    head('Vérification', 'Un dernier coup d’œil avant de télécharger ton CV.'),
    h('ul', { class: 'checks' }, items.map((i) => h('li', { class: `check ${i.level}` }, h('span', { class: 'check-icon' }, i.level === 'ok' ? '✓' : '!'), i.text))),
    h('button', { class: 'btn-primary btn-lg', type: 'button', disabled: blocking, onClick: ctx.download }, 'Télécharger mon CV (PDF)'),
    blocking && h('p', { class: 'hint' }, 'Complète les points marqués ! pour pouvoir télécharger.'),
  );
}
