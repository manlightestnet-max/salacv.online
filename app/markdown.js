// Markdown minimal pour les réponses de l'agent : **gras**, *italique*, `code`,
// listes (« - », « * », « • », « 1. ») et paragraphes. Construit des nœuds DOM
// (jamais d'innerHTML) : le texte du modèle ne peut pas injecter de HTML.
import { h } from './dom.js';

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_|`[^`\n]+`)/g;

function inline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**') || token.startsWith('__')) out.push(h('strong', {}, token.slice(2, -2)));
    else if (token.startsWith('`')) out.push(h('code', {}, token.slice(1, -1)));
    else out.push(h('em', {}, token.slice(1, -1)));
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function markdown(text) {
  const blocks = [];
  let list = null;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      const p = h('p');
      para.forEach((line, i) => {
        if (i) p.append(h('br'));
        p.append(...inline(line));
      });
      blocks.push(p);
      para = [];
    }
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (BULLET.test(line)) {
      flushPara();
      list ??= h(/^\s*\d/.test(line) ? 'ol' : 'ul');
      list.append(h('li', {}, inline(line.replace(BULLET, ''))));
    } else {
      flushList();
      para.push(line.replace(/^#{1,6}\s+/, ''));
    }
  }
  flushPara();
  flushList();
  return blocks;
}
