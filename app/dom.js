import { attachSuggest } from './suggest.js';

// Mini helper pour créer le DOM sans framework.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

let uid = 0;

// Icônes au trait (24×24, couleur du texte). Une seule source pour toute l'interface.
const ICONS = {
  chevrons: '<path d="M6 6l6 6-6 6M12 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.2 5.8"/><path d="M20 4v7h-7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  alert: '<path d="M12 6.5v7"/><path d="M12 17.6v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 017.5 4H16"/>',
};
export function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2.2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('ico', `ico-${name}`);
  s.innerHTML = ICONS[name];
  return s;
}

// obj → { clé: { root, input } } : retrouve le champ d'une donnée (proposition de l'IA, erreurs).
export const fieldIndex = new WeakMap();
export function indexField(obj, key, root, input) {
  if (!obj || typeof obj !== 'object') return;
  const map = fieldIndex.get(obj) ?? {};
  map[key] = { root, input };
  fieldIndex.set(obj, map);
}

// Erreur de saisie sur un champ : bordure, message sous le champ, focus. Disparaît à la frappe.
export function setInputError(root, input, message) {
  clearInputError(root);
  root.classList.add('has-error');
  input?.setAttribute('aria-invalid', 'true');
  const id = `e${++uid}`;
  root.append(h('p', { class: 'field-error', id, role: 'alert' }, message));
  input?.setAttribute('aria-describedby', id);
  input?.focus?.({ preventScroll: false });
  input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}
export function clearInputError(root) {
  root.classList.remove('has-error');
  root.querySelector(':scope > .field-error')?.remove();
  root.querySelectorAll('[aria-invalid]').forEach((el) => (el.removeAttribute('aria-invalid'), el.removeAttribute('aria-describedby')));
}

// Champ texte lié à obj[key]. multiline : textarea.
export function field(label, obj, key, onInput, { multiline = false, placeholder = '', hint = '', rows = 3, list, type, autocomplete, suggest } = {}) {
  const id = `f${++uid}`;
  const input = h(multiline ? 'textarea' : 'input', {
    id,
    class: 'input',
    placeholder,
    rows: multiline ? rows : null,
    list,
    type: multiline ? null : type,
    autocomplete,
    value: obj[key],
    enterkeyhint: multiline ? null : 'next',
    onInput: (e) => {
      obj[key] = e.target.value;
      onInput();
    },
    onKeydown: multiline ? null : (e) => e.key === 'Enter' && !e.isComposing && (e.preventDefault(), focusNext(e.target)),
  });
  const root = h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'hint' }, hint));
  indexField(obj, key, root, input);
  input.addEventListener('input', () => root.classList.contains('has-error') && clearInputError(root));
  if (suggest && !multiline) attachSuggest(input, suggest);
  return root;
}

// Entrée dans un champ d'une ligne : champ suivant de l'étape ; au dernier, le clavier se ferme.
export function focusNext(from) {
  const scope = from.closest('.step') ?? document;
  const fields = [...scope.querySelectorAll('input.input, textarea.input, .period-button')].filter((el) => !el.closest('[inert], [hidden]') && el.offsetParent);
  const next = fields[fields.indexOf(from) + 1];
  if (next) next.focus();
  else from.blur();
}
