// Autocomplete : suggestions sous le champ, + « Rechercher davantage » qui ouvre une
// recherche par mots-clés dans la même liste. La recherche complète l'autocomplete, elle
// ne le remplace pas. La liste est en position fixe (les blocs repliables rognent le débordement).
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { SUGGEST, SUGGEST_TITLE } from './suggest-data.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const entries = (kind) => (SUGGEST[kind] ?? []).map((raw) => {
  const [label, tags = ''] = raw.split('|');
  return { label, hay: norm(`${label} ${tags}`), start: norm(label) };
});
const cache = {};
const all = (kind) => (cache[kind] ??= entries(kind));

// Tous les mots tapés doivent se retrouver (libellé ou mots-clés) ; ceux qui commencent par la saisie d'abord.
export function search(kind, query, limit = 50, exclude = []) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const skip = new Set(exclude.map(norm));
  const hits = all(kind).filter((e) => !skip.has(e.start) && words.every((w) => e.hay.includes(w)));
  hits.sort((a, b) => Number(b.start.startsWith(words[0] ?? '')) - Number(a.start.startsWith(words[0] ?? '')));
  return hits.slice(0, limit).map((e) => e.label);
}

let openList = null;
const closeList = () => openList?.close();

// Attache l'autocomplete à un <input>. onPick(valeur) : appelé quand une suggestion est choisie.
// exclude() : valeurs déjà présentes (listes de compétences).
// onPickMany(valeurs) : active la sélection multiple dans la recherche avancée (listes de compétences, loisirs).
export function attachSuggest(input, kind, { onPick, onPickMany, exclude = () => [] } = {}) {
  if (!SUGGEST[kind]) return;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  let box = null;
  let rows = [];
  let active = -1;

  let muted = false; // pendant un choix : la saisie et le focus ne rouvrent pas la liste
  const pick = (value) => {
    muted = true;
    close();
    if (onPick) onPick(value);
    else {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.focus({ preventScroll: true });
    muted = false;
  };

  function place() {
    if (!box) return;
    // Champ replié, masqué ou retiré du formulaire : plus rien à suggérer.
    if (!input.isConnected || !input.offsetParent || input.closest('[inert]')) return close();
    const r = input.getBoundingClientRect();
    const below = innerHeight - r.bottom - 8;
    const up = r.top - 8 > below && below < 200;
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - r.width - 8))}px`;
    box.style.width = `${r.width}px`;
    box.style.maxHeight = `${Math.max(140, Math.min(300, up ? r.top - 12 : below))}px`;
    if (up) Object.assign(box.style, { top: 'auto', bottom: `${innerHeight - r.top + 4}px` });
    else Object.assign(box.style, { top: `${r.bottom + 4}px`, bottom: 'auto' });
    // Champ sorti de la zone visible (défilement du formulaire) : on referme.
    const scroller = input.closest('.step-scroll');
    if (scroller) {
      const s = scroller.getBoundingClientRect();
      if (r.bottom < s.top || r.top > s.bottom) close();
    }
  }

  function setActive(i) {
    active = rows.length ? (i + rows.length) % rows.length : -1;
    [...box.querySelectorAll('.sg-item')].forEach((el, k) => el.classList.toggle('on', k === active));
    box.querySelector('.sg-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    box?.remove();
    box = null;
    rows = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    if (openList?.input === input) openList = null;
    removeEventListener('resize', place);
    document.removeEventListener('scroll', place, true);
  }

  function render() {
    if (muted) return;
    const q = input.value.trim();
    rows = search(kind, q, 8, exclude());
    if (!q && !rows.length) return close();
    if (!box) {
      closeList();
      box = h('div', { class: 'sg', role: 'listbox' });
      // mousedown : le champ garde le focus, le clic ne le « perd » pas avant d'agir.
      box.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.append(box);
      openList = { input, close };
      input.setAttribute('aria-expanded', 'true');
      addEventListener('resize', place);
      document.addEventListener('scroll', place, true);
    }
    box.replaceChildren(
      h(
        'div',
        { class: 'sg-head' },
        h('span', {}, q ? 'Suggestions' : 'Suggestions pour commencer'),
        h('button', { type: 'button', class: 'sg-more', onClick: () => openSearch(q) }, 'Rechercher davantage'),
      ),
      ...(rows.length
        ? rows.map((label, i) => h('button', { type: 'button', class: 'sg-item', role: 'option', onClick: () => pick(label), onMouseenter: () => setActive(i) }, label))
        : [h('p', { class: 'sg-empty' }, 'Aucune suggestion. Garde ton texte, ou essaie « Rechercher davantage ».')]),
    );
    active = -1;
    place();
  }

  function openSearch(initial) {
    close();
    const field = h('input', { class: 'input', type: 'search', placeholder: 'Mots-clés : réseau, comptabilité, Brazzaville…', 'data-autofocus': true, value: initial ?? '' });
    const out = h('ul', { class: 'sg-results' });
    const count = h('p', { class: 'hint' });
    const chosen = new Set(); // sélection multiple : garde les choix d'une recherche à l'autre
    const addBtn = h('button', { type: 'button', class: 'btn-primary', onClick: () => (dlg.close(), onPickMany([...chosen])) });
    const syncAdd = () => {
      addBtn.disabled = !chosen.size;
      addBtn.textContent = chosen.size ? `Ajouter (${chosen.size})` : 'Ajouter';
    };
    const row = (label) => {
      if (!onPickMany) return h('li', {}, h('button', { type: 'button', class: 'sg-result', onClick: () => (dlg.close(), pick(label)) }, label));
      const box = h('input', { type: 'checkbox', checked: chosen.has(label) || null });
      box.addEventListener('change', () => (box.checked ? chosen.add(label) : chosen.delete(label), syncAdd()));
      return h('li', {}, h('label', { class: 'sg-result sg-check' }, box, h('span', {}, label)));
    };
    const run = () => {
      const found = search(kind, field.value, 60, exclude());
      const hintMulti = onPickMany ? ' Coche plusieurs éléments, puis « Ajouter ».' : '';
      count.textContent = field.value.trim() ? `${found.length} résultat${found.length > 1 ? 's' : ''}.${hintMulti}` : `Tape un mot-clé pour chercher parmi les ${SUGGEST_TITLE[kind]}.${hintMulti}`;
      out.replaceChildren(
        ...found.map(row),
        ...(field.value.trim() && !found.length ? [h('li', { class: 'sg-empty' }, 'Aucun résultat. Essaie un mot plus court.')] : []),
      );
    };
    field.addEventListener('input', run);
    const dlg = openDialog({
      title: `Rechercher parmi les ${SUGGEST_TITLE[kind]}`,
      className: 'sg-dialog',
      content: [field, count, out],
      footer: [h('button', { type: 'button', class: 'btn-ghost', onClick: () => dlg.close() }, onPickMany ? 'Annuler' : 'Fermer'), onPickMany && addBtn],
    });
    syncAdd();
    run();
    field.focus();
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => input.value.trim() && render());
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (!box) return;
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive(active + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(active - 1));
    else if (e.key === 'Escape') (e.stopPropagation(), close());
    else if (e.key === 'Enter' && active >= 0) {
      // Capture : l'Entrée du champ (passer au suivant) ne doit pas partir aussi.
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(rows[active]);
    }
  }, true);
}
