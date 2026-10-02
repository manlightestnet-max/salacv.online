// Composants du formulaire. Chacun met à jour son propre DOM (ajout,
// suppression, repli) au lieu de reconstruire l'étape : le focus, le scroll et
// la saisie en cours restent en place.
import { h } from './dom.js';

let uid = 0;

const removeBtn = (label, onClick) =>
  h('button', { class: 'icon-btn danger', type: 'button', title: label, 'aria-label': label, onClick }, '✕');

// Liste de valeurs courtes : on tape, Entrée (ou « Ajouter ») ajoute en bas,
// ✕ supprime. variant 'chips' : pastilles en ligne ; 'rows' : une ligne par élément.
// Coller plusieurs lignes ajoute chaque ligne.
export function itemsInput({ label, list, onChange, placeholder = '', hint = '', variant = 'rows', max = Infinity, type = 'text' }) {
  const id = `f${++uid}`;
  const items = h('ul', { class: `items items-${variant}`, 'aria-label': label });
  const input = h('input', { id, class: 'input', type, placeholder, enterkeyhint: 'done', autocomplete: 'off' });
  const addBtn = h('button', { class: 'btn-ghost', type: 'button' }, 'Ajouter');
  const entry = h('div', { class: 'items-entry' }, input, addBtn);

  const node = (value) => {
    const li = h('li', { class: 'item' }, h('span', { class: 'item-text' }, value));
    li.append(
      removeBtn(`Supprimer « ${value} »`, () => {
        const i = [...items.children].indexOf(li);
        list.splice(i, 1);
        li.remove();
        sync();
        onChange();
        input.focus();
      }),
    );
    return li;
  };

  function sync() {
    entry.hidden = list.length >= max;
    items.hidden = !list.length;
  }

  // Ajoute une ou plusieurs valeurs ; retourne vrai si quelque chose a été ajouté.
  function add(raw) {
    let added = false;
    for (const value of raw.split('\n').map((v) => v.trim()).filter(Boolean)) {
      if (list.length >= max) break;
      if (list.some((v) => v.toLowerCase() === value.toLowerCase())) continue; // pas de doublon
      list.push(value);
      items.append(node(value));
      added = true;
    }
    if (added) {
      sync();
      onChange();
    }
    return added;
  }

  function submit() {
    if (!input.value.trim()) return;
    add(input.value);
    input.value = '';
    input.focus();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Backspace' && !input.value && list.length) {
      // Retour arrière dans un champ vide : supprime le dernier élément.
      list.pop();
      items.lastElementChild.remove();
      sync();
      onChange();
    }
  });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    add(text);
  });
  addBtn.addEventListener('click', submit);

  items.append(...list.map(node));
  sync();
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    items,
    entry,
    h('p', { class: 'hint' }, hint || (variant === 'chips' ? 'Entrée pour ajouter.' : 'Entrée pour ajouter. Tu peux aussi coller une liste.')),
  );
}

// Choix d'une valeur parmi des pastilles (cliquer à nouveau désélectionne).
export function choicePills({ label, options, obj, key, onChange }) {
  const id = `g${++uid}`;
  const buttons = options.map((value) =>
    h('button', {
      class: 'pill-option',
      type: 'button',
      'aria-pressed': String(obj[key] === value),
      onClick: () => {
        obj[key] = obj[key] === value ? '' : value;
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(obj[key] === options[i])));
        onChange();
      },
    }, value),
  );
  return h('div', { class: 'field' }, h('span', { class: 'field-label', id }, label), h('div', { class: 'pill-options', role: 'group', 'aria-labelledby': id }, buttons));
}

// Liste de blocs repliables (formations, expériences, langues). Un seul bloc
// ouvert à la fois : en ajouter un replie les autres en une ligne résumée au
// format du CV ; cliquer sur un résumé le rouvre.
//   summary(item) -> [{ text, cls }]   résumé affiché quand le bloc est replié
//   fields(item, onInput) -> nœuds     champs du bloc (construits une seule fois)
export function accordion({ list, create, label, empty, addLabel, summary, fields, onChange }) {
  const wrap = h('div', { class: 'accordion' });
  const cards = [];
  let open = list.length === 1 ? 0 : -1;

  function renderSummary(card) {
    const parts = summary(card.item).filter((p) => p.text);
    card.summary.replaceChildren(...(parts.length ? parts.map((p) => h('span', { class: p.cls ?? '' }, p.text)) : [h('span', { class: 'acc-empty' }, empty)]));
  }

  function makeCard(item) {
    const card = { item };
    const onInput = () => {
      renderSummary(card);
      onChange();
    };
    const bodyId = `a${++uid}`;
    card.num = h('span', { class: 'acc-num' });
    card.summary = h('span', { class: 'acc-summary' });
    card.toggle = h(
      'button',
      { class: 'acc-toggle', type: 'button', 'aria-controls': bodyId, onClick: () => setOpen(cards.indexOf(card) === open ? -1 : cards.indexOf(card)) },
      card.num,
      card.summary,
      h('span', { class: 'acc-chevron', 'aria-hidden': 'true' }, '›'),
    );
    card.inner = h('div', { class: 'acc-inner' }, fields(item, onInput));
    card.body = h('div', { class: 'acc-body', id: bodyId }, card.inner);
    card.el = h(
      'div',
      { class: 'acc-card' },
      h(
        'div',
        { class: 'acc-head' },
        card.toggle,
        removeBtn(`Supprimer ce bloc`, () => remove(card)),
      ),
      card.body,
    );
    renderSummary(card);
    return card;
  }

  function setOpen(index) {
    open = index;
    cards.forEach((c, i) => {
      const isOpen = i === index;
      c.el.classList.toggle('open', isOpen);
      c.toggle.setAttribute('aria-expanded', String(isOpen));
      c.inner.inert = !isOpen;
    });
  }

  function renumber() {
    cards.forEach((c, i) => (c.num.textContent = `${label} ${String(i + 1).padStart(2, '0')}`));
  }

  function remove(card) {
    const i = cards.indexOf(card);
    cards.splice(i, 1);
    list.splice(i, 1);
    card.el.remove();
    renumber();
    setOpen(open === i ? -1 : open > i ? open - 1 : open);
    onChange();
  }

  function add() {
    const item = create();
    list.push(item);
    const card = makeCard(item);
    cards.push(card);
    wrap.append(card.el);
    renumber();
    setOpen(cards.length - 1);
    onChange();
    requestAnimationFrame(() => {
      card.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      card.inner.querySelector('input, textarea')?.focus({ preventScroll: true });
    });
  }

  for (const item of list) {
    const card = makeCard(item);
    cards.push(card);
    wrap.append(card.el);
  }
  renumber();
  setOpen(open);

  const el = h('div', { class: 'accordion-wrap' }, wrap, h('button', { class: 'btn-add', type: 'button', onClick: add }, `+ ${addLabel}`, h('kbd', {}, 'Ctrl ↵')));
  return { el, add };
}
