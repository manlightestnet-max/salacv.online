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
import { emptyItem, emptyLanguage, fromResume, LEVELS, SECTION_TITLES } from './state.js';

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

function hitTest(ops, kit, px, py) {
  const pad = 2.5;
  const photo = ops.find((o) => o.t === 'image' && px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h);
  let best = null;
  for (const l of textLines(ops, kit)) {
    const box = { x: l.x - pad, y: l.y - l.size * 0.85 - pad, w: l.w + pad * 2, h: l.size * 1.15 + pad * 2 };
    if (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) continue;
    if (!best || box.w * box.h < best.box.w * best.box.h) best = { text: l.s, box };
  }
  if (best) return best;
  if (photo) return { photo: true, box: { x: photo.x, y: photo.y, w: photo.w, h: photo.h } };
  return null;
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
  add(SECTION_TITLES.education, { kind: 'section', list: 'education' });
  add(SECTION_TITLES.experiences, { kind: 'section', list: 'experiences' });
  add(SECTION_TITLES.skills, { kind: 'skills' });
  add(SECTION_TITLES.languages, { kind: 'language', index: 0 });
  add(SECTION_TITLES.hobbies, { kind: 'hobbies' });
  add('Profil professionnel', { kind: 'summary' });
  add('Profil', { kind: 'summary' });
  return out;
}

export function resolveTarget(text, state, mockupState) {
  const f = norm(text);
  if (f.length < 2) return null;
  const score = (c) => {
    if (c.v === f) return 1000 + f.length;
    if (c.v.includes(f)) return 500 + (f.length / c.v.length) * 100;
    if (f.includes(c.v) && c.v.length >= 3) return 200 + c.v.length;
    return 0;
  };
  for (const pool of [candidates(state, false), mockupState ? candidates(mockupState, true) : []]) {
    let best = null;
    for (const c of pool) {
      const s = score(c);
      if (s && (!best || s > best.s)) best = { s, target: c.target };
    }
    if (best) return best.target;
  }
  return null;
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

function editor(target, state, changed, close) {
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
      return [photoInput({ profile: p, onChange: changed })];
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
export function initQuickEdit({ canvases, preview, fonts, getDoc, getState, mockup, changed, onClose, enabled = () => true }) {
  const kit = createKit(fonts);
  const mockupState = fromResume(mockup);
  const outline = h('div', { class: 'qe-outline', hidden: true });
  document.body.append(outline);
  let editing = null;

  function locate(e) {
    const canvas = e.target.closest?.('canvas');
    const doc = getDoc();
    if (!canvas || !doc || !canvases.contains(canvas)) return null;
    const page = [...canvases.querySelectorAll('canvas')].indexOf(canvas);
    const r = canvas.getBoundingClientRect();
    const k = r.width / doc.width;
    const hit = hitTest(doc.pages[page] ?? [], kit, (e.clientX - r.left) / k, (e.clientY - r.top) / k);
    if (!hit) return null;
    const box = { left: r.left + hit.box.x * k, top: r.top + hit.box.y * k, width: hit.box.w * k, height: hit.box.h * k };
    return { hit, box };
  }

  function show(box, strong = false) {
    Object.assign(outline.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    outline.classList.toggle('strong', strong);
    outline.hidden = false;
  }

  // PC : contour au survol de ce qui est modifiable.
  let frame = 0;
  canvases.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || editing || !enabled()) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const found = locate(e);
      const ok = found && (found.hit.photo || resolveTarget(found.hit.text, getState(), mockupState));
      canvases.style.cursor = ok ? 'pointer' : '';
      if (ok) show(found.box);
      else outline.hidden = true;
    });
  });
  canvases.addEventListener('pointerleave', () => !editing && (outline.hidden = true));
  preview.addEventListener('scroll', () => !editing && (outline.hidden = true), { passive: true });

  canvases.addEventListener('click', (e) => {
    if (!enabled()) return;
    const found = locate(e);
    if (!found) return;
    const state = getState();
    const raw = found.hit.photo ? { kind: 'photo' } : resolveTarget(found.hit.text, state, mockupState);
    if (!raw) return;
    const target = realTarget(raw, state);
    show(found.box, true);
    open(target, found.box);
  });

  function open(target, box) {
    const state = getState();
    const isItem = target.kind === 'item';
    const title = isItem ? (target.list === 'education' ? 'Formation' : 'Expérience') : TITLES[target.kind];
    let dialog;
    const close = () => dialog.close();
    dialog = openDialog({
      title,
      className: 'quick-edit',
      content: editor(target, state, changed, close),
      footer: [h('button', { type: 'button', class: 'btn-primary', onClick: close }, 'Terminé')],
      onClose: () => {
        editing = null;
        outline.hidden = true;
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
      Object.assign(dialog.el.style, { position: 'fixed', width: `${w}px`, left: `${left}px`, top: `${Math.max(12, Math.min(box.top - 20, window.innerHeight - 420))}px` });
    }
    // Premier champ prêt à la saisie (pas sur mobile : le clavier cacherait le CV d'un coup).
    if (!window.matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => dialog.el.querySelector('.input')?.focus());
  }
}
