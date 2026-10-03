// Édition directe sur l'aperçu : toucher un élément du CV (nom, expérience, langue,
// photo…) ouvre, juste là, une mini fenêtre avec seulement les champs de cet élément.
// Pas besoin de passer par les étapes. Le CV se met à jour pendant la saisie.
//
// Principe : on retrouve les lignes de texte de la display list sous le doigt, puis on
// reconnaît à quelle saisie du formulaire elles appartiennent (comparaison de texte).
// Le contenu d'exemple (gris) mène au champ vide correspondant.
import { createKit } from '../src/layout/engine.js';
import { h, field } from './dom.js';
import { openDialog } from './dialog.js';
import { itemsInput, choicePills, photoInput } from './components.js';
import { periodField } from './period.js';
import { askAgent } from './ai.js';
import { emptyItem, emptyLanguage, fromResume, LEVELS, sectionTitle } from './state.js';
import { label } from '../src/i18n/index.js';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[•·|—–:/,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Lignes de texte d'une page : les ops d'une même ligne (lettres espacées, morceaux
// de texte riche) sont recollées pour retrouver le texte saisi.
function textLines(ops, kit) {
  const runs = ops
    .filter((o) => o.t === 'text' && !o.rotate && o.s.trim())
    .map((o) => ({ x: o.x, y: o.y, size: o.size, s: o.s, w: kit.width(o.s, o) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const r of runs) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - r.y) < 0.6 && r.x - (last.x + last.w) < r.size * 0.9 && r.x >= last.x + last.w - 1) {
      last.s += r.x - (last.x + last.w) > r.size * 0.2 ? ` ${r.s}` : r.s;
      last.w = r.x + r.w - last.x;
      last.size = Math.max(last.size, r.size);
    } else lines.push({ ...r });
  }
  return lines;
}

const PAD = 2.5;
const lineBox = (l) => ({ x: l.x - PAD, y: l.y - l.size * 0.85 - PAD, w: l.w + PAD * 2, h: l.size * 1.15 + PAD * 2 });
const inside = (b, px, py) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;

function hitTest(ops, kit, px, py) {
  const lines = textLines(ops, kit);
  let best = null;
  for (const l of lines) {
    const box = lineBox(l);
    if (inside(box, px, py) && (!best || box.w * box.h < best.box.w * best.box.h)) best = { text: l.s, box, line: l };
  }
  if (best) return { ...best, lines };
  const photo = ops.find((o) => o.t === 'image' && inside(o, px, py));
  if (photo) return { photo: true, box: { x: photo.x, y: photo.y, w: photo.w, h: photo.h }, lines };
  // Initiales à la place de la photo : on les traite comme la photo.
  return null;
}

const keyOf = (t) => (t ? `${t.kind}:${t.list ?? ''}:${t.index ?? ''}:${t.ghost ? 1 : 0}` : '');

// Sélection au niveau du groupe, comme dans un éditeur vidéo : le contour englobe les
// lignes de la même saisie ET qui se touchent (même bloc à l'écran). Une ligne identique
// ailleurs sur la page (autre colonne, autre section) n'est jamais aspirée dans le groupe.
// Ce qui ne correspond à aucune saisie (décor, filigrane, libellés du modèle) est verrouillé.
function groupBox(lines, hit, target, resolve) {
  const key = keyOf(target);
  const same = lines.filter((l) => l !== hit && keyOf(resolve(l)) === key);
  const cluster = [hit];
  const near = (a, b) => {
    const A = lineBox(a);
    const B = lineBox(b);
    const gapY = Math.max(0, Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h));
    const gapX = Math.max(0, Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w));
    return gapY <= Math.max(a.size, b.size) * 1.6 && gapX <= 24;
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (let k = same.length - 1; k >= 0; k--) {
      if (cluster.some((c) => near(c, same[k]))) {
        cluster.push(same.splice(k, 1)[0]);
        grew = true;
      }
    }
  }
  let box = null;
  for (const l of cluster) {
    const b = lineBox(l);
    if (!box) box = { ...b };
    else {
      const x2 = Math.max(box.x + box.w, b.x + b.w);
      const y2 = Math.max(box.y + box.h, b.y + b.h);
      box.x = Math.min(box.x, b.x);
      box.y = Math.min(box.y, b.y);
      box.w = x2 - box.x;
      box.h = y2 - box.y;
    }
  }
  return box;
}

// Tout ce que l'étudiant peut saisir, avec la cible d'édition de chaque valeur.
function candidates(state, ghost) {
  const out = [];
  const add = (value, target) => {
    for (const v of String(value ?? '').split('\n')) if (norm(v)) out.push({ v: norm(v), target: { ...target, ghost } });
  };
  const p = state.profile;
  add(p.name, { kind: 'identity' });
  add(p.title, { kind: 'identity' });
  add(p.summary, { kind: 'summary' });
  for (const v of [p.email, p.address, p.link, ...p.phones]) add(v, { kind: 'contact' });
  for (const list of ['education', 'experiences']) {
    state[list].forEach((it, index) => {
      for (const k of ['title', 'org', 'period', 'details']) add(it[k], { kind: 'item', list, index });
    });
  }
  state.skills.forEach((v) => add(v, { kind: 'skills' }));
  state.hobbies.forEach((v) => add(v, { kind: 'hobbies' }));
  state.languages.forEach((l, index) => {
    add(l.name, { kind: 'language', index });
  });
  // Intitulés de sections : on ouvre la liste correspondante.
  // Titres dans la langue du CV (tableau i18n/cv.csv).
  const T = (key) => sectionTitle(state.lang, key);
  add(T('education'), { kind: 'section', list: 'education' });
  add(T('experiences'), { kind: 'section', list: 'experiences' });
  add(T('skills'), { kind: 'skills' });
  add(T('languages'), { kind: 'language', index: 0 });
  add(T('hobbies'), { kind: 'hobbies' });
  add(label(state.lang, 'label.profilePro'), { kind: 'summary' });
  add(label(state.lang, 'label.profile'), { kind: 'summary' });
  return out;
}

export function resolveTarget(text, state, mockupState, pools = [candidates(state, false), mockupState ? candidates(mockupState, true) : []]) {
  const f = norm(text);
  if (f.length < 2) return null;
  const score = (c) => {
    if (c.v === f) return 1000 + f.length;
    // Fragment d'une saisie (ligne coupée d'un paragraphe) : assez long pour ne pas être un hasard.
    if (f.length >= 8 && c.v.includes(f)) return 500 + (f.length / c.v.length) * 100;
    // Une saisie contenue dans la ligne (« période | titre — école ») : mot entier, assez longue.
    if (c.v.length >= 6 && ` ${f} `.includes(` ${c.v} `)) return 200 + c.v.length;
    return 0;
  };
  for (const pool of pools) {
    let best = null;
    let tie = false;
    const fragments = new Set();
    for (const c of pool) {
      const s = score(c);
      if (!s) continue;
      if (!best || s > best.s) best = { s, target: c.target };
      if (s < 1000) fragments.add(keyOf(c.target));
    }
    // Un fragment qui appartient à plusieurs saisies différentes, sans correspondance exacte.
    tie = Boolean(best) && best.s < 1000 && fragments.size > 1;
    // Fragment commun à deux saisies (« CERTIFICATIONS ») : on ne devine pas.
    if (best) return tie ? AMBIGUOUS : best.target;
  }
  return null;
}
const AMBIGUOUS = { ambiguous: true };

// Une ligne, et si elle est ambiguë, avec sa voisine du dessus ou du dessous (même colonne) :
// un titre coupé en deux lignes se reconnaît en entier.
function lineResolver(lines, resolveText) {
  const column = (a, b) => Math.abs(a.x - b.x) < 3 && Math.abs(a.size - b.size) < 0.5;
  return (line) => {
    const t = resolveText(line.s);
    if (t !== AMBIGUOUS) return t;
    const above = lines.find((o) => o !== line && column(o, line) && line.y - o.y > 0 && line.y - o.y < line.size * 1.8);
    const below = lines.find((o) => o !== line && column(o, line) && o.y - line.y > 0 && o.y - line.y < line.size * 1.8);
    for (const text of [above && `${above.s} ${line.s}`, below && `${line.s} ${below.s}`]) {
      const r = text && resolveText(text);
      if (r && r !== AMBIGUOUS) return r;
    }
    return null;
  };
}

// Contenu d'exemple touché : la cible devient le premier élément vide du formulaire.
function realTarget(target, state) {
  if (!target.ghost) return target;
  if (target.kind === 'item' || target.kind === 'section') {
    const list = state[target.list];
    let index = list.findIndex((i) => !i.title.trim());
    if (index < 0) index = list.push(emptyItem()) - 1;
    return { kind: 'item', list: target.list, index };
  }
  if (target.kind === 'language') {
    let index = state.languages.findIndex((l) => !l.name.trim());
    if (index < 0) index = state.languages.push(emptyLanguage()) - 1;
    return { kind: 'language', index };
  }
  return { kind: target.kind };
}

const TITLES = {
  identity: 'Nom et profession',
  contact: 'Contacts',
  summary: 'Profil professionnel',
  skills: 'Compétences',
  hobbies: 'Loisirs',
  language: 'Langue',
  photo: 'Photo',
};

function editor(target, state, changed, close, photoShape) {
  const p = state.profile;
  switch (target.kind) {
    case 'identity':
      return [field('Nom complet', p, 'name', changed, { autocomplete: 'name' }), field('Profession ou domaine', p, 'title', changed)];
    case 'contact':
      return [
        field('Email', p, 'email', changed, { type: 'email', autocomplete: 'email' }),
        itemsInput({ label: 'Téléphones', list: p.phones, onChange: changed, variant: 'chips', max: 3, type: 'tel', placeholder: '+243 81 234 5678' }),
        field('Adresse', p, 'address', changed),
      ];
    case 'summary':
      return [field('Profil professionnel', p, 'summary', changed, { multiline: true, rows: 6 })];
    case 'skills':
      return [itemsInput({ label: 'Compétences', list: state.skills, onChange: changed, variant: 'chips', placeholder: 'Câblage structuré' })];
    case 'hobbies':
      return [itemsInput({ label: 'Loisirs', list: state.hobbies, onChange: changed, variant: 'chips', placeholder: 'Football' })];
    case 'language': {
      const l = state.languages[target.index];
      if (!l) return [];
      return [field('Langue', l, 'name', changed, { placeholder: 'Français' }), choicePills({ label: 'Niveau', options: LEVELS, obj: l, key: 'level', onChange: changed })];
    }
    case 'photo':
      return [photoInput({ profile: p, onChange: changed, shape: photoShape })];
    case 'item': {
      const it = state[target.list][target.index];
      if (!it) return [];
      const edu = target.list === 'education';
      return [
        periodField(it, 'period', changed),
        field(edu ? 'Diplôme ou certification' : 'Poste', it, 'title', changed),
        field(edu ? 'Établissement' : 'Entreprise ou organisation', it, 'org', changed),
        field(edu ? 'Ce que tu as appris' : 'Tes tâches', it, 'details', changed, { multiline: true, rows: 4, hint: 'Une ligne par point.' }),
        h(
          'button',
          {
            type: 'button',
            class: 'btn-text danger-text',
            onClick: () => {
              const list = state[target.list];
              list.splice(target.index, 1);
              if (!list.length) list.push(emptyItem());
              changed();
              close();
            },
          },
          edu ? 'Supprimer cette formation' : 'Supprimer cette expérience',
        ),
      ];
    }
    default:
      return [];
  }
}

// canvases : conteneur des pages ; getDoc() : layout affiché ; getState() : formulaire.
export function initQuickEdit({ canvases, preview, fonts, getDoc, getState, mockup, changed, onClose, photoShape = () => null, enabled = () => true, replaceState, askLogin, inspector = () => null }) {
  const kit = createKit(fonts);
  const mockupState = fromResume(mockup);
  const outline = h('div', { class: 'qe-outline', hidden: true });
  document.body.append(outline);
  let editing = null;

  function locate(e) {
    const canvas = e.target.closest?.('canvas.page');
    const doc = getDoc();
    if (!canvas || !doc || !canvases.contains(canvas)) return null;
    const page = [...canvases.querySelectorAll('canvas.page')].indexOf(canvas);
    const r = canvas.getBoundingClientRect();
    const k = r.width / doc.width;
    const hit = hitTest(doc.pages[page] ?? [], kit, (e.clientX - r.left) / k, (e.clientY - r.top) / k);
    if (!hit) return null;
    const state = getState();
    const pools = [candidates(state, false), candidates(mockupState, true)];
    const resolve = lineResolver(hit.lines, (text) => resolveTarget(text, state, mockupState, pools));
    // Initiales affichées à la place de la photo (pas encore de photo) : on ouvre la photo.
    const initials = !hit.photo && /^[A-ZÀ-Ý]{1,3}$/.test(hit.text.trim());
    const target = hit.photo || initials ? { kind: 'photo' } : resolve(hit.line);
    if (!target) return null;
    const b = (target.kind !== 'photo' && groupBox(hit.lines, hit.line, target, resolve)) || hit.box;
    const box = { left: r.left + b.x * k - 3, top: r.top + b.y * k - 3, width: b.w * k + 6, height: b.h * k + 6 };
    return { target, box };
  }

  function show(box, strong = false) {
    Object.assign(outline.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    outline.classList.toggle('strong', strong);
    outline.hidden = false;
  }

  // PC : contour au survol de ce qui est modifiable.
  let frame = 0;
  canvases.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || editing || selected || !enabled()) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const found = locate(e);
      canvases.style.cursor = found ? 'pointer' : '';
      if (selected) return; // la sélection reste affichée tant qu'on ne la quitte pas
      if (found) show(found.box);
      else outline.hidden = true;
    });
  });
  canvases.addEventListener('pointerleave', () => !editing && !selected && (outline.hidden = true));
  preview.addEventListener('scroll', () => !editing && (outline.hidden = true), { passive: true });

  // --- Barre d'actions flottante -------------------------------------------------
  // Toucher un élément le sélectionne (contour) et fait apparaître juste au-dessus une
  // petite barre : Modifier, Ajouter, Supprimer — le geste de Canva ou Google Docs.
  // Double-clic (PC) : directement Modifier.
  const bar = h('div', { class: 'qe-bar', role: 'toolbar', 'aria-label': 'Actions', hidden: true });
  document.body.append(bar);
  let selected = null; // { raw, box }

  function deselect() {
    selected = null;
    bar.hidden = true;
    if (!editing) outline.hidden = true;
  }

  function actions(raw) {
    const state = getState();
    const list = raw.kind === 'item' || raw.kind === 'section' ? raw.list : null;
    const noun = { education: 'une formation', experiences: 'une expérience' }[list];
    const out = [];
    if (raw.kind !== 'section') out.push({ icon: ICONS.edit, label: 'Modifier', run: () => open(realTarget(raw, state), selected.box) });
    if (list) out.push({ icon: ICONS.add, label: `Ajouter ${noun}`, short: 'Ajouter', run: () => open(addItem(state, list), selected.box) });
    if (raw.kind === 'skills' || raw.kind === 'hobbies') out.push({ icon: ICONS.add, label: 'Ajouter', run: () => open({ kind: raw.kind, focusAdd: true }, selected.box) });
    if (raw.kind === 'language') out.push({ icon: ICONS.add, label: 'Ajouter une langue', short: 'Ajouter', run: () => open(addLanguage(state), selected.box) });
    if (!raw.ghost && raw.kind === 'item') out.push({ icon: ICONS.remove, label: 'Supprimer', danger: true, run: () => removeItem(state, raw) });
    if (!raw.ghost && raw.kind === 'language') out.push({ icon: ICONS.remove, label: 'Supprimer', danger: true, run: () => removeLanguage(state, raw) });
    if (raw.kind === 'photo' && state.profile.photo) out.push({ icon: ICONS.remove, label: 'Retirer', danger: true, run: () => ((state.profile.photo = ''), changed(), deselect()) });
    return out;
  }

  function select(raw, box) {
    selected = { raw, box };
    show(box, true);
    const label = raw.kind === 'item' ? (raw.list === 'education' ? 'Formation' : 'Expérience') : raw.kind === 'section' ? (raw.list === 'education' ? 'Formation' : 'Expérience') : TITLES[raw.kind];
    bar.replaceChildren(
      h('span', { class: 'qe-bar-label' }, label, raw.ghost && h('em', {}, ' · exemple')),
      ...actions(raw).map((a) =>
        h(
          'button',
          { type: 'button', class: `qe-act${a.danger ? ' danger' : ''}`, title: a.label, 'aria-label': a.label, onClick: (e) => (e.stopPropagation(), a.run()) },
          icon(a.icon),
          h('span', { class: 'qe-act-text' }, a.short ?? a.label),
        ),
      ),
    );
    bar.hidden = false;
    // Au-dessus de l'élément, sinon en dessous ; toujours dans l'écran.
    const r = bar.getBoundingClientRect();
    const top = box.top - r.height - 8 > 8 ? box.top - r.height - 8 : box.top + box.height + 8;
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, box.left + box.width / 2 - r.width / 2));
    Object.assign(bar.style, { top: `${top}px`, left: `${left}px` });
  }

  function addItem(state, list) {
    let index = state[list].findIndex((i) => !i.title.trim());
    if (index < 0) index = state[list].push(emptyItem()) - 1;
    return { kind: 'item', list, index, fresh: true };
  }
  function addLanguage(state) {
    let index = state.languages.findIndex((l) => !l.name.trim());
    if (index < 0) index = state.languages.push(emptyLanguage()) - 1;
    return { kind: 'language', index, fresh: true };
  }
  function removeItem(state, raw) {
    const list = state[raw.list];
    list.splice(raw.index, 1);
    if (!list.length) list.push(emptyItem());
    changed();
    deselect();
  }
  function removeLanguage(state, raw) {
    state.languages.splice(raw.index, 1);
    if (!state.languages.length) state.languages.push(emptyLanguage());
    changed();
    deselect();
  }

  canvases.addEventListener('click', (e) => {
    if (!enabled()) return;
    const found = locate(e);
    if (!found) return deselect();
    e.stopPropagation();
    if (editing?.inspector) editing = null; // le panneau passe à la nouvelle sélection
    select(found.target, found.box);
    if (inspector()) open(realTarget(found.target, getState()), found.box);
  });
  canvases.addEventListener('dblclick', (e) => {
    if (!enabled() || !selected) return;
    open(realTarget(selected.raw, getState()), selected.box);
  });
  document.addEventListener('click', (e) => !e.target.closest('.qe-bar, #canvases, .dialog-backdrop') && deselect());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !editing && deselect());
  preview.addEventListener('scroll', () => selected && !editing && deselect(), { passive: true });
  // Espace Pro : la caméra bouge (glisser, zoom) → le contour ne garde plus son repère.
  preview.addEventListener('ws-camera', () => {
    if (selected && !editing) deselect();
    if (!editing) outline.hidden = true;
  });

  // Onglet IA : la question du champ en haut (on reste dans le contexte), l'étudiant écrit
  // comme il parle, l'assistant met en forme ce seul élément.
  function aiPane(target, state) {
    const question = aiQuestion(target, state);
    const text = h('textarea', { class: 'input', rows: 5, placeholder: 'Écris comme tu parles, même en vrac…' });
    const status = h('p', { class: 'qe-ai-status', 'aria-live': 'polite' });
    const go = h('button', { type: 'button', class: 'btn-primary qe-ai-go' }, '✦ Donner vie');
    go.addEventListener('click', async () => {
      const said = text.value.trim();
      if (!said) return text.focus();
      go.disabled = true;
      status.textContent = 'L’IA écrit…';
      const r = await askAgent(getState(), aiMessage(target, getState(), said));
      go.disabled = false;
      if (!r.ok) {
        status.textContent = r.error ?? 'L’IA n’a pas pu répondre. Réessaie.';
        if (r.login && askLogin) status.append(' ', h('button', { type: 'button', class: 'btn-text', onClick: () => (editing?.close(), askLogin()) }, 'Me connecter'));
        return;
      }
      replaceState(r.state);
      const box = selected?.box ?? lastBox;
      editing?.close();
      // On rouvre le formulaire de l'élément, rempli par l'IA : l'étudiant relit et corrige.
      setTimeout(() => open({ ...target, fresh: false }, box), 200);
    });
    return {
      el: h(
        'div',
        { class: 'qe-pane qe-ai' },
        h('p', { class: 'qe-ai-question' }, question),
        h('p', { class: 'qe-ai-hint' }, 'L’IA met en forme sans rien inventer. Tu relis ensuite.'),
        text,
        h('div', { class: 'qe-ai-row' }, status, go),
      ),
    };
  }

  let lastBox = null;
  function open(target, box) {
    lastBox = box;
    if (!inspector()) bar.hidden = true;
    const state = getState();
    const isItem = target.kind === 'item';
    const base = isItem ? (target.list === 'education' ? 'Formation' : 'Expérience') : TITLES[target.kind];
    const title = target.fresh ? `Nouvelle ${base === 'Expérience' ? 'expérience' : base === 'Formation' ? 'formation' : 'langue'}` : base;
    let dialog;
    const close = () => dialog.close();
    const form = h('div', { class: 'qe-pane' }, editor(target, state, changed, close, photoShape));
    const ai = AI_KINDS.has(target.kind) && replaceState ? aiPane(target, state) : null;
    let content = form;
    if (ai) {
      const tabs = ['Formulaire', '✦ IA'].map((label, i) =>
        h('button', { type: 'button', role: 'tab', class: 'qe-tab', 'aria-selected': String(i === 0), onClick: () => pick(i) }, label),
      );
      const pick = (i) => {
        tabs.forEach((t, k) => t.setAttribute('aria-selected', String(k === i)));
        form.hidden = i !== 0;
        ai.el.hidden = i !== 1;
        (i === 1 ? ai.el.querySelector('textarea') : form.querySelector('.input'))?.focus();
      };
      ai.el.hidden = true;
      content = [h('div', { class: 'qe-tabs', role: 'tablist' }, tabs), form, ai.el];
    }
    // Mode Pro : le contenu de l'élément sélectionné s'affiche dans le panneau de gauche
    // (comme l'inspecteur d'un éditeur), pas dans une fenêtre.
    const panel = inspector();
    if (panel) {
      const closeIns = () => {
        editing = null;
        selected = null;
        bar.hidden = true;
        outline.hidden = true;
        onClose?.();
      };
      dialog = { close: closeIns, el: panel, inspector: true };
      editing = dialog;
      panel.replaceChildren(
        h(
          'div',
          { class: 'inspector fade' },
          h('div', { class: 'ins-head' }, h('div', {}, h('span', { class: 'ins-kicker' }, target.ghost ? 'Sélection · exemple' : 'Sélection'), h('strong', {}, title)), h('button', { type: 'button', class: 'btn-ghost', onClick: closeIns }, 'Toutes les étapes')),
          ...[content].flat(),
        ),
      );
      if (!window.matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => panel.querySelector(target.focusAdd ? '.items-entry .input, .input' : '.input')?.focus({ preventScroll: true }));
      return;
    }
    dialog = openDialog({
      title,
      className: 'quick-edit',
      content,
      footer: [h('button', { type: 'button', class: 'btn-primary', onClick: close }, 'Terminé')],
      onClose: () => {
        editing = null;
        outline.hidden = true;
        selected = null;
        onClose?.();
      },
    });
    editing = dialog;
    // PC : la fenêtre s'ouvre à côté de l'élément touché, pas au centre.
    if (window.matchMedia('(min-width: 960px)').matches) {
      const w = 360;
      const right = box.left + box.width + 16;
      const left = right + w < window.innerWidth - 12 ? right : Math.max(12, box.left - w - 16);
      dialog.el.parentElement.classList.add('qe-backdrop');
      Object.assign(dialog.el.style, { position: 'fixed', width: `${w}px`, left: `${left}px`, maxHeight: `${window.innerHeight - 24}px` });
      // Hauteur réelle connue après rendu : la fenêtre reste entière dans l'écran.
      const place = () => {
        const hgt = dialog.el.offsetHeight;
        dialog.el.style.top = `${Math.max(12, Math.min(box.top - 12, window.innerHeight - hgt - 12))}px`;
      };
      place();
      requestAnimationFrame(place);
      draggable(dialog.el);
    }
    // Premier champ prêt à la saisie (pas sur mobile : le clavier cacherait le CV d'un coup).
    if (target.focusAdd) requestAnimationFrame(() => dialog.el.querySelector('.items-entry .input, .input')?.focus());
    else if (!window.matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => dialog.el.querySelector('.input')?.focus());
  }
}

// PC : la fenêtre se déplace en la tenant par son titre, pour dégager la partie du CV
// que l'on veut voir.
function draggable(panel) {
  const handle = panel.querySelector('.dialog-head');
  handle.classList.add('drag-handle');
  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const left = Math.min(window.innerWidth - 80, Math.max(-panel.offsetWidth + 80, start.left + e.clientX - start.x));
    const top = Math.min(window.innerHeight - 48, Math.max(0, start.top + e.clientY - start.y));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
  const end = () => {
    start = null;
    panel.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

const svg = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  remove: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};

function icon(markup) {
  const el = h('span', { class: 'qe-ico', 'aria-hidden': 'true' });
  el.innerHTML = markup; // SVG constant du code, jamais du contenu saisi
  return el;
}

// --- IA par champ -------------------------------------------------------------------
const AI_KINDS = new Set(['identity', 'summary', 'item', 'skills', 'hobbies', 'language']);

function aiQuestion(target, state) {
  if (target.kind === 'item') {
    const it = state[target.list][target.index] ?? {};
    if (target.list === 'experiences') return it.org?.trim() ? `Qu’as-tu fait chez ${it.org.trim()} ?` : 'Raconte cette expérience : où, quand, et ce que tu faisais.';
    return it.title?.trim() ? `Qu’as-tu appris en ${it.title.trim()} ?` : 'Raconte cette formation : le diplôme, l’école, les années.';
  }
  return {
    identity: 'Comment t’appelles-tu, et quel métier vises-tu ?',
    summary: 'Qui es-tu, que sais-tu faire, et que cherches-tu ?',
    skills: 'Qu’est-ce que tu sais faire ? Écris en vrac.',
    hobbies: 'Que fais-tu de ton temps libre ?',
    language: 'Quelles langues parles-tu, et à quel niveau ?',
  }[target.kind];
}

function aiMessage(target, state, said) {
  const only = 'Ne modifie rien d’autre dans le CV. N’invente rien : utilise seulement ce que l’étudiant dit.';
  if (target.kind === 'item') {
    const it = state[target.list][target.index] ?? {};
    const where = target.list === 'experiences' ? 'Expérience professionnelle' : 'Formation & certifications';
    const which = it.title?.trim() ? `l’élément « ${it.title.trim()}${it.org ? ` — ${it.org}` : ''} »` : 'un nouvel élément';
    return `Section ${where}, ${which}. L’étudiant raconte : « ${said} ». Remplis ou réécris uniquement cet élément : intitulé, organisation, période si elle est donnée, et ${target.list === 'experiences' ? 'tâches en lignes courtes avec des verbes d’action' : 'ce qui a été appris, en lignes courtes'}. ${only}`;
  }
  const what = {
    identity: 'le nom complet et la profession (titre du CV)',
    summary: 'le profil professionnel (2 à 3 phrases)',
    skills: 'la liste des compétences (ajoute-les, formulées proprement, sans doublon)',
    hobbies: 'la liste des loisirs (ajoute-les, formulés proprement)',
    language: 'les langues et leur niveau (Natif, Courant, Professionnel, Intermédiaire ou Notions)',
  }[target.kind];
  return `L’étudiant dit : « ${said} ». Mets à jour uniquement ${what}. ${only}`;
}
