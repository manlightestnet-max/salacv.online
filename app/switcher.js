// Mes CV dans le studio : un carrousel des 5 CV récents (le CV ouvert au centre), pour
// passer de l'un à l'autre d'un toucher, en créer un nouveau, ou partir d'une personnalité.
import { layoutResume } from '../src/index.js';
import example from '../examples/etudiant.json';
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { drawDoc } from './lib/engine.js';
import { listPersonas, listProjects, projectName, relativeDate, savePersona } from './lib/store.js';
import { toResume } from './state.js';

export const MAX_OPEN = 5;

// ctx : { engine, project, state, save() }
export function openSwitcher(ctx) {
  const projects = listProjects().slice(0, MAX_OPEN);
  if (!projects.some((p) => p.id === ctx.project.id)) projects.unshift({ ...ctx.project, state: ctx.state });

  const track = h('div', { class: 'sw-track' });
  const dots = h('div', { class: 'sw-dots', 'aria-hidden': 'true' });
  const cards = projects.map((p) => {
    const current = p.id === ctx.project.id;
    const canvas = h('canvas', { class: 'sw-paper' });
    if (ctx.engine) {
      const r = layoutResume(toResume(current ? ctx.state : p.state, { mockup: example }), ctx.engine.fonts);
      if (r.ok) requestAnimationFrame(() => drawDoc(ctx.engine, canvas, r.doc, 150));
    }
    return h(
      'a',
      { class: `sw-card${current ? ' current' : ''}`, href: current ? '#' : `/studio/?p=${p.id}`, onClick: (e) => current && (e.preventDefault(), dialog.close()) },
      h('div', { class: 'sw-frame' }, canvas, current && h('span', { class: 'sw-badge' }, 'Ouvert')),
      h('strong', {}, projectName(current ? { ...p, state: ctx.state, name: ctx.project.name } : p)),
      h('small', {}, current ? 'en cours' : relativeDate(p.updatedAt)),
    );
  });
  track.append(...cards);
  dots.append(...cards.map(() => h('span')));

  // Le point actif suit la carte au centre.
  const syncDots = () => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    cards.forEach((c, i) => Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid) && (best = i));
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === best));
  };
  track.addEventListener('scroll', () => requestAnimationFrame(syncDots), { passive: true });

  const personas = listPersonas();
  const fromPersona = personas.length
    ? h(
        'div',
        { class: 'sw-personas' },
        h('p', { class: 'sw-label' }, 'Nouveau CV depuis une personnalité'),
        h('div', { class: 'sw-chips' }, personas.map((p) => h('a', { class: 'pill-option', href: `/studio/?new&persona=${p.id}` }, p.name))),
      )
    : null;

  const savedNote = h('p', { class: 'sw-note', 'aria-live': 'polite' });
  const dialog = openDialog({
    title: 'Mes CV',
    className: 'switcher-dialog',
    content: [
      h('p', { class: 'sw-hint' }, `Tes ${MAX_OPEN} CV les plus récents. Touche un CV pour l’ouvrir ; tout est enregistré automatiquement.`),
      track,
      dots,
      fromPersona,
      savedNote,
    ],
    footer: [
      h(
        'button',
        {
          type: 'button',
          class: 'btn-text',
          title: 'Garder tes informations pour tes prochains CV (technicien ici, médecin là)',
          onClick: () => {
            const p = savePersona({ name: ctx.state.profile.name, state: ctx.state });
            savedNote.textContent = `Personnalité « ${p.name} » enregistrée : tu pourras partir d’elle pour un autre CV.`;
          },
        },
        'Enregistrer comme personnalité',
      ),
      h('a', { class: 'btn-ghost', href: '/dashboard/' }, 'Tous mes CV'),
      h('a', { class: 'btn-primary', href: '/studio/?new' }, '+ Nouveau CV'),
    ],
  });
  requestAnimationFrame(() => {
    const cur = track.querySelector('.current');
    cur?.scrollIntoView({ inline: 'center', block: 'nearest' });
    syncDots();
  });
}
