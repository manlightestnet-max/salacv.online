// Connexion avec des CV faits sans compte sur ce navigateur (bac à sable du visiteur) : on propose de les ajouter au
// compte. Sinon le visiteur perdrait ce qu'il voulait justement télécharger sans filigrane.
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { normalizeState } from './state.js';
import { projectName, sandboxPending, syncSandbox } from './lib/store.js';

// → Promise<{ ids: { ancien: nouveau } }>, résolue une fois le choix fait (tout de suite s'il n'y a rien à proposer).
export function offerSandboxSync() {
  const { projects, personas } = sandboxPending();
  if (!projects.length && !personas.length) return Promise.resolve({ ids: {} });
  return new Promise((resolve) => {
    let result = { ids: {} };
    const n = projects.length;
    const what = [n && `${n} CV`, personas.length && `${personas.length} personnalité${personas.length > 1 ? 's' : ''}`].filter(Boolean).join(' et ');
    const many = n + personas.length > 1;
    const names = projects.slice(0, 4).map((p) => h('li', {}, projectName({ ...p, state: normalizeState(p.state) })));
    const status = h('p', { class: 'sync-status', role: 'status', hidden: true });
    const add = h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true }, 'Ajouter à mon compte');
    const later = h('button', { type: 'button', class: 'btn-ghost' }, 'Plus tard');
    const d = openDialog({
      title: 'Récupérer ton travail ?',
      className: 'sync-dialog',
      content: [
        h('p', { class: 'dlg-text' }, `Tu as ${what} fait${many ? 's' : ''} sans compte sur cet appareil. Ajoute-${many ? 'les' : 'le'} à ton compte pour ${many ? 'les' : 'le'} garder et ${many ? 'les' : 'le'} télécharger sans filigrane.`),
        names.length > 0 && h('ul', { class: 'sync-list' }, names, n > 4 && h('li', { class: 'more' }, `et ${n - 4} autre${n - 4 > 1 ? 's' : ''}`)),
        status,
      ],
      footer: [later, add],
      onClose: () => resolve(result),
    });
    later.addEventListener('click', () => d.close());
    add.addEventListener('click', async () => {
      add.disabled = later.disabled = true;
      add.textContent = 'Ajout en cours…';
      result = await syncSandbox();
      if (!result.failed) return d.close();
      status.hidden = false;
      const why = (result.error || 'réessaie plus tard').replace(/[.\s]+$/, '');
      status.textContent = `${result.moved} ajouté${result.moved > 1 ? 's' : ''}, ${result.failed} non ajouté${result.failed > 1 ? 's' : ''} : ${why}. Ce qui n’est pas ajouté reste sur cet appareil.`;
      later.disabled = false;
      later.textContent = 'Fermer';
      add.remove();
    });
  });
}
