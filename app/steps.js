// Les 5 étapes du formulaire. Chaque étape construit son DOM à partir de
// l'état ; `ctx.changed()` met l'aperçu à jour, `ctx.rerender()` reconstruit
// l'étape après un changement de structure (ajout, suppression, déplacement).
import { h, field } from './dom.js';
import { emptyItem, LEVELS, checklist } from './state.js';

export const STEPS = [
  { id: 'profil', label: 'Profil', render: profile },
  { id: 'experiences', label: 'Expériences', render: (ctx) => timeline(ctx, 'experiences', EXP), add: (s) => s.experiences.push(emptyItem()) },
  { id: 'formation', label: 'Formation', render: (ctx) => timeline(ctx, 'education', EDU), add: (s) => s.education.push(emptyItem()) },
  { id: 'competences', label: 'Compétences', render: skills, add: (s) => s.skills.push({ label: '', items: '' }) },
  { id: 'verification', label: 'Vérification', render: review },
];

const EXP = {
  title: 'Tes expériences',
  intro: 'Stages, jobs, bénévolat, projets associatifs : tout ce qui montre ce que tu sais faire.',
  item: 'Expérience',
  add: 'Ajouter une expérience',
  fields: { title: ['Poste', 'Développeuse web stagiaire'], org: ['Organisation', 'Kin Digital Lab'], location: ['Lieu', 'Gombe, Kinshasa'], period: ['Période', 'Juin — Sept. 2025'] },
  bullets: ['Ce que tu as fait', 'Développé l’espace client d’une boutique en ligne\nIntégré le paiement mobile money'],
};

const EDU = {
  title: 'Ta formation',
  intro: 'Commence par la plus récente.',
  item: 'Formation',
  add: 'Ajouter une formation',
  fields: { title: ['Diplôme', 'Licence en génie informatique'], org: ['Établissement', 'Université de Kinshasa'], location: ['Lieu', 'Kinshasa'], period: ['Période', '2023 — 2026'] },
  bullets: ['Détails (facultatif)', 'Mention, projet de fin d’études…'],
};

function head(title, intro) {
  return h('div', { class: 'step-head' }, h('h2', {}, title), intro && h('p', {}, intro));
}

function profile(ctx) {
  const p = ctx.state.profile;
  const f = (label, key, opts) => field(label, p, key, ctx.changed, opts);
  return h(
    'div',
    { class: 'step' },
    head('Ton profil', 'Les informations en haut de ton CV.'),
    f('Nom complet', 'name', { placeholder: 'Grâce Mbuyi Kalala' }),
    f('Titre', 'title', { placeholder: 'Étudiante en génie informatique — recherche de stage' }),
    h('div', { class: 'grid-2' }, f('Email', 'email', { placeholder: 'grace@email.cd' }), f('Téléphone', 'phone', { placeholder: '+243 81 234 5678' })),
    h('div', { class: 'grid-2' }, f('Ville', 'location', { placeholder: 'Kinshasa, RDC' }), f('Lien', 'link', { placeholder: 'github.com/grace' })),
    f('Disponibilité', 'badge', { placeholder: 'Disponible — stage 2026', hint: 'Affichée dans une pastille verte en haut du CV. Laisse vide pour la masquer.' }),
    f('Résumé', 'summary', { multiline: true, rows: 4, placeholder: 'En deux ou trois phrases : qui tu es et ce que tu cherches.' }),
    h('button', { class: 'btn-link', type: 'button', onClick: ctx.loadExample }, 'Remplir avec un exemple'),
  );
}

// Boutons monter / descendre / supprimer d'un élément de liste.
function itemTools(ctx, list, i) {
  const move = (d) => () => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    ctx.rerender();
  };
  return h(
    'div',
    { class: 'item-tools' },
    h('button', { class: 'icon-btn', type: 'button', title: 'Monter', 'aria-label': 'Monter', disabled: i === 0, onClick: move(-1) }, '↑'),
    h('button', { class: 'icon-btn', type: 'button', title: 'Descendre', 'aria-label': 'Descendre', disabled: i === list.length - 1, onClick: move(1) }, '↓'),
    h('button', {
      class: 'icon-btn danger',
      type: 'button',
      title: 'Supprimer',
      'aria-label': 'Supprimer',
      onClick: () => {
        list.splice(i, 1);
        ctx.rerender();
      },
    }, '✕'),
  );
}

function timeline(ctx, key, copy) {
  const list = ctx.state[key];
  const cards = list.map((item, i) => {
    const f = (k, opts) => field(copy.fields[k][0], item, k, ctx.changed, { placeholder: copy.fields[k][1], ...opts });
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'card-label' }, `${copy.item.toUpperCase()} ${String(i + 1).padStart(2, '0')}`), itemTools(ctx, list, i)),
      f('title'),
      h('div', { class: 'grid-2' }, f('org'), f('period')),
      f('location'),
      field(copy.bullets[0], item, 'bullets', ctx.changed, { multiline: true, rows: 3, placeholder: copy.bullets[1], hint: 'Un élément par ligne.' }),
    );
  });
  return h('div', { class: 'step' }, head(copy.title, copy.intro), cards, addButton(ctx, copy.add));
}

function addButton(ctx, label) {
  return h('button', { class: 'btn-add', type: 'button', onClick: ctx.addItem }, `+ ${label}`, h('kbd', {}, 'Ctrl ↵'));
}

function skills(ctx) {
  const s = ctx.state;
  const groups = s.skills.map((g, i) =>
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('span', { class: 'card-label' }, `GROUPE ${String(i + 1).padStart(2, '0')}`), itemTools(ctx, s.skills, i)),
      field('Nom du groupe', g, 'label', ctx.changed, { placeholder: 'Développement' }),
      field('Compétences', g, 'items', ctx.changed, { placeholder: 'JavaScript, React, SQL', hint: 'Séparées par des virgules.' }),
    ),
  );

  const langs = s.languages.map((l, i) =>
    h(
      'div',
      { class: 'lang-row' },
      field('Langue', l, 'name', ctx.changed, { placeholder: 'Lingala' }),
      field('Niveau', l, 'level', ctx.changed, { placeholder: 'Natif', list: 'levels' }),
      itemTools(ctx, s.languages, i),
    ),
  );

  return h(
    'div',
    { class: 'step' },
    head('Compétences et langues', 'Ce que tu maîtrises, en mots-clés courts.'),
    groups,
    addButton(ctx, 'Ajouter un groupe'),
    h('h3', { class: 'sub' }, 'Langues'),
    h('datalist', { id: 'levels' }, LEVELS.map((v) => h('option', { value: v }))),
    langs,
    h('button', {
      class: 'btn-add',
      type: 'button',
      onClick: () => {
        s.languages.push({ name: '', level: '' });
        ctx.rerender();
      },
    }, '+ Ajouter une langue'),
    h('h3', { class: 'sub' }, "Centres d'intérêt"),
    field('Centres d’intérêt', s, 'interests', ctx.changed, { multiline: true, rows: 2, placeholder: 'Football, photographie, mentorat…' }),
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
