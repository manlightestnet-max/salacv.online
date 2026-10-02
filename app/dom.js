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

// Champ texte lié à obj[key]. multiline : textarea.
export function field(label, obj, key, onInput, { multiline = false, placeholder = '', hint = '', rows = 3, list } = {}) {
  const id = `f${++uid}`;
  const input = h(multiline ? 'textarea' : 'input', {
    id,
    class: 'input',
    placeholder,
    rows: multiline ? rows : null,
    list,
    value: obj[key],
    onInput: (e) => {
      obj[key] = e.target.value;
      onInput();
    },
  });
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'hint' }, hint));
}
