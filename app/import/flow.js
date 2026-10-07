// Importer un CV existant : choisir le document → l'IA le lit → « Vérifie ce que j'ai lu » → le CV.
//   L'IA comprend, le système vérifie (chaque valeur cherchée dans le texte du PDF), l'utilisateur confirme.
//   Rien n'est gardé : le fichier est lu dans le téléphone, envoyé une fois, puis oublié.
import { h } from '../dom.js';
import { openDialog } from '../dialog.js';
import { readPdf, readPhoto, MAX_PAGES } from './pdf.js';
import './import.css';

const LEVELS = ['Natif', 'Courant', 'Professionnel', 'Intermédiaire', 'Notions'];
const MODE_LABEL = { text: 'Texte du PDF · le plus économique', mixed: 'Pages + texte · mise en page en colonnes', scan: 'Image · document scanné ou photo' };
const svg = (paths, size = 26) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
};
const ICON = {
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 13h7M8.5 16.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  photo: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  spark: '<path fill="currentColor" d="M12 2.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5z"/>',
};

async function send(body) {
  try {
    const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' } };
  }
}

/** onDone(state) : le CV vérifié (forme du studio, sans modèle ni photo). onQuota(quota) : jauge de l'IA. */
export function openImport({ onDone, onQuota } = {}) {
  const body = h('div', { class: 'imp' });
  const foot = h('div', { class: 'imp-foot' });
  const dialog = openDialog({ title: 'Importer mon CV', className: 'imp-dialog', content: body, footer: foot });
  const show = (...nodes) => body.replaceChildren(...nodes);

  // --- 1. Le document ---------------------------------------------------------------------------
  function pick() {
    const pdf = h('input', { type: 'file', accept: 'application/pdf', hidden: true });
    const photo = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/heic,image/heif', hidden: true });
    const tile = (cls, icon, title, sub, input) =>
      h('button', { type: 'button', class: `imp-tile ${cls}`, onClick: () => input.click() }, h('span', { class: 'imp-tile-icon' }, svg(icon)), h('strong', {}, title), h('small', {}, sub), h('span', { class: 'imp-tile-shine', 'aria-hidden': 'true' }));
    pdf.addEventListener('change', () => pdf.files?.[0] && run(pdf.files[0], 'pdf'));
    photo.addEventListener('change', () => photo.files?.[0] && run(photo.files[0], 'photo'));
    show(
      h('p', { class: 'imp-lead' }, 'L’IA lit ton ancien CV et remplit tout. Tu vérifies, puis tu choisis ton nouveau modèle.'),
      h('div', { class: 'imp-tiles' }, tile('pdf', ICON.pdf, 'Mon CV en PDF', `${MAX_PAGES} pages au plus`, pdf), tile('photo', ICON.photo, 'Une photo de mon CV', 'Ou une capture d’écran', photo)),
      pdf,
      photo,
      h('p', { class: 'imp-note' }, 'Ton fichier est lu puis oublié : il n’est gardé nulle part.'),
    );
    foot.replaceChildren(h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler'));
  }

  // --- 2. Lecture : dans le téléphone, puis l'IA -----------------------------------------------------
  async function run(file, kind) {
    const ring = h('div', { class: 'imp-ring', style: '--p:4' }, h('div', { class: 'imp-ring-in' }, svg(ICON.spark, 30)));
    const now = h('p', { class: 'imp-now', 'aria-live': 'polite' }, 'Préparation…');
    const chip = h('span', { class: 'imp-chip', hidden: true });
    const steps = ['Lecture du document', 'L’IA comprend ton CV', 'Vérification de chaque valeur'].map((t) => h('li', { class: 'imp-step' }, h('span', { class: 'imp-dot', 'aria-hidden': 'true' }), t));
    const at = (i, p) => {
      steps.forEach((s, k) => {
        s.classList.toggle('done', k < i);
        s.classList.toggle('on', k === i);
      });
      ring.style.setProperty('--p', String(p));
    };
    show(h('div', { class: 'imp-progress' }, ring, now, chip), h('ol', { class: 'imp-steps' }, steps));
    foot.replaceChildren(h('p', { class: 'imp-note' }, 'Quelques secondes : garde cette fenêtre ouverte.'));
    at(0, 8);
    let doc;
    try {
      const onStep = (label) => (now.textContent = label);
      doc = kind === 'pdf' ? await readPdf(file, { onStep }) : await readPhoto(file, { onStep });
    } catch (err) {
      return fail(err?.message?.includes('Invalid PDF') || err?.name === 'InvalidPDFException' ? 'Ce fichier n’est pas un PDF lisible.' : err?.message || 'Document illisible.');
    }
    chip.textContent = MODE_LABEL[doc.mode];
    chip.hidden = false;
    at(1, 30);
    now.textContent = doc.pageCount > MAX_PAGES ? `L’IA lit les ${MAX_PAGES} premières pages…` : 'L’IA lit ton CV…';
    // La réponse de l'IA prend quelques secondes : l'anneau avance doucement jusqu'à 85 %.
    let p = 30;
    const creep = setInterval(() => at(1, (p = Math.min(85, p + (85 - p) * 0.08))), 400);
    const { status, data } = await send({ mode: doc.mode, pages: doc.pages });
    clearInterval(creep);
    if (data.quota) onQuota?.(data.quota);
    if (status === 401) return fail(data.error, { login: true });
    if (!data.ok) return fail(data.error || 'La lecture n’a pas abouti. Réessaie.', { quota: data.code === 'AI_QUOTA' });
    at(2, 95);
    now.textContent = 'Vérification de chaque valeur…';
    await new Promise((r) => setTimeout(r, 450));
    at(3, 100);
    review(data.candidate);
  }

  function fail(text, { login = false, quota = false } = {}) {
    show(h('div', { class: 'imp-fail' }, h('strong', {}, 'Import impossible'), h('p', {}, text)));
    foot.replaceChildren(
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Fermer'),
      login
        ? h('a', { class: 'btn-primary', href: `/auth/?next=${encodeURIComponent('/studio/?new&import')}` }, 'Se connecter avec Google')
        : quota
          ? h('a', { class: 'btn-primary', href: '/dashboard/#credits' }, 'Recharger mon IA')
          : h('button', { type: 'button', class: 'btn-primary', onClick: pick }, 'Réessayer'),
    );
  }

  // --- 3. « Vérifie ce que j'ai lu » -------------------------------------------------------------------
  function review(c) {
    const st = structuredClone(c.state);
    const todo = new Set(c.verify);
    const notes = new Map(c.issues.map((i) => [i.path, i.message]));
    const counter = h('span', { class: 'imp-count' });
    const refresh = () => {
      counter.textContent = todo.size ? `${todo.size} à vérifier` : 'Tout est vérifié';
      counter.classList.toggle('ok', !todo.size);
    };
    // Un champ : l'orange part dès qu'on le touche (vérifié) ; la note du système reste sous le champ.
    const field = (label, value, paths, onValue, { area = false, wide = false } = {}) => {
      const input = area ? h('textarea', { class: 'imp-input', rows: Math.min(6, Math.max(2, String(value).split('\n').length)) }, value) : h('input', { class: 'imp-input', value });
      const flagged = paths.filter((p) => todo.has(p));
      const wrap = h('label', { class: `imp-field${flagged.length ? ' verify' : ''}${wide ? ' wide' : ''}` }, h('span', { class: 'imp-label' }, label, flagged.length ? h('em', {}, 'à vérifier') : null), input);
      const note = paths.map((p) => notes.get(p)).find(Boolean);
      if (note) wrap.append(h('small', { class: 'imp-issue' }, note));
      const resolve = () => {
        if (!flagged.length) return;
        flagged.forEach((p) => todo.delete(p));
        flagged.length = 0;
        wrap.classList.remove('verify');
        wrap.querySelector('em')?.remove();
        refresh();
      };
      input.addEventListener('input', () => (onValue(input.value), resolve()));
      input.addEventListener('blur', resolve);
      return wrap;
    };
    const card = (title, ...children) => h('section', { class: 'imp-card' }, h('h3', {}, title), ...children);
    const pf = st.profile;
    const identity = card(
      'Identité',
      h(
        'div',
        { class: 'imp-grid' },
        field('Nom', pf.name, ['profile.name'], (v) => (pf.name = v)),
        field('Métier', pf.title, ['profile.title'], (v) => (pf.title = v)),
        field('E-mail', pf.email, ['profile.email'], (v) => (pf.email = v)),
        field('Téléphones', pf.phones.join(' · '), pf.phones.map((_, i) => `profile.phones.${i}`), (v) => (pf.phones = v.split(/[·,;]/).map((x) => x.trim()).filter(Boolean))),
        field('Adresse', pf.address, ['profile.address'], (v) => (pf.address = v), { wide: true }),
        pf.summary || todo.has('profile.summary') ? field('Profil', pf.summary, ['profile.summary'], (v) => (pf.summary = v), { area: true, wide: true }) : null,
      ),
    );
    const timeline = (key, title, empty) => {
      const list = h('div', { class: 'imp-entries' });
      const draw = () =>
        list.replaceChildren(
          ...(st[key].length
            ? st[key].map((it, i) => {
                const details = it.details.split('\n').filter(Boolean);
                return h(
                  'div',
                  { class: 'imp-entry' },
                  h('button', { type: 'button', class: 'imp-x', 'aria-label': `Retirer « ${it.title || 'cette entrée'} »`, onClick: () => (st[key].splice(i, 1), [...todo].filter((p) => p.startsWith(`${key}.`)).forEach((p) => todo.delete(p)), refresh(), draw()) }, '✕'),
                  h(
                    'div',
                    { class: 'imp-grid' },
                    field('Intitulé', it.title, [`${key}.${i}.title`, `${key}.${i}`], (v) => (it.title = v)),
                    field(key === 'education' ? 'Établissement' : 'Entreprise', it.org, [`${key}.${i}.org`], (v) => (it.org = v)),
                    field('Période', it.period, [`${key}.${i}.period`], (v) => (it.period = v)),
                    details.length ? field('Détails (une ligne chacun)', it.details, details.map((_, j) => `${key}.${i}.details.${j}`), (v) => (it.details = v), { area: true, wide: true }) : null,
                  ),
                );
              })
            : [h('p', { class: 'imp-empty' }, empty)]),
        );
      draw();
      return card(title, list);
    };
    const words = (key, title) =>
      st[key].length
        ? card(title, field('Un élément par ligne', st[key].join('\n'), st[key].map((_, i) => `${key}.${i}`), (v) => (st[key] = v.split('\n').map((x) => x.trim()).filter(Boolean)), { area: true, wide: true }))
        : null;
    const langs = st.languages.length
      ? card(
          'Langues',
          h(
            'div',
            { class: 'imp-langs' },
            st.languages.map((l, i) => {
              const level = h('select', { class: 'imp-input', 'aria-label': `Niveau en ${l.name}` }, h('option', { value: '' }, '—'), LEVELS.map((v) => h('option', { value: v, selected: v === l.level || null }, v)));
              level.addEventListener('change', () => ((l.level = level.value), todo.delete(`languages.${i}.level`), refresh()));
              return h('div', { class: 'imp-lang' }, field('Langue', l.name, [`languages.${i}.name`], (v) => (l.name = v)), h('label', { class: `imp-field${todo.has(`languages.${i}.level`) ? ' verify' : ''}` }, h('span', { class: 'imp-label' }, 'Niveau'), level));
            }),
          ),
        )
      : null;

    show(
      h(
        'div',
        { class: 'imp-head' },
        h('strong', {}, 'Vérifie ce que j’ai lu'),
        h('p', {}, c.proven ? 'Chaque valeur a été retrouvée dans ton PDF, sauf celles en orange.' : 'Document scanné ou photo : relis bien, surtout ce qui est en orange.'),
        h('div', { class: 'imp-meta' }, h('span', { class: 'imp-chip' }, `${c.counts.fields} éléments lus`), counter),
      ),
      identity,
      timeline('experiences', 'Expériences', 'Aucune expérience lue.'),
      timeline('education', 'Formation', 'Aucune formation lue.'),
      words('skills', 'Compétences'),
      langs,
      words('hobbies', 'Loisirs'),
    );
    refresh();
    let warned = false;
    const go = h('button', { type: 'button', class: 'btn-primary imp-cta' }, 'Créer mon CV');
    go.addEventListener('click', () => {
      if (todo.size && !warned) {
        warned = true;
        const first = body.querySelector('.imp-field.verify');
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        first?.classList.add('nudge');
        go.textContent = `Continuer quand même (${todo.size} à vérifier)`;
        return;
      }
      dialog.close();
      onDone?.(st);
    });
    foot.replaceChildren(h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler'), go);
  }

  pick();
  return dialog;
}
