// Carte « Générer mon CV », partagée par l'assistant écrit et l'assistant en direct.
// L'utilisateur touche « Générer », la carte montre l'avancement, puis « Télécharger ».
// Le serveur revérifie et débite (un crédit pour une nouvelle version propre) ; sans crédit, filigrane.
//   g   : { version, label, loggedIn, balance, cost, enough } (réponse de l'outil generate_cv)
//   ctx : { renderState(version), onSpent?(balance), onRecharge?() } — onRecharge : ouvre la recharge sur place
//         (le direct ne doit pas quitter la page) ; sinon, lien vers les crédits du tableau de bord.
import { h } from './dom.js';
import { MIME, callRender, save, slug, toBlob } from './export.js';
import { formatCredits } from './lib/store.js';

const here = () => `/auth/?next=${encodeURIComponent(location.pathname + location.search)}`;

export function generateCard(g, ctx) {
  const card = h('div', { class: 'msg-card gen-card' });
  const name = () => slug(ctx.renderState?.(g.version)?.profile?.name || 'CV') || 'CV';
  const idle = () => {
    const line = g.enough
      ? g.cost > 0
        ? `1 crédit · il t’en restera ${formatCredits(g.balance - g.cost)}`
        : 'Déjà préparée : gratuit'
      : g.loggedIn
        ? `Solde : ${formatCredits(g.balance)} crédit · sans crédit, le PDF sort avec filigrane`
        : 'Sans compte, le PDF sort avec filigrane';
    const go = h('button', { type: 'button', class: 'btn-primary gen-go' }, g.enough ? 'Générer mon CV' : 'Générer (avec filigrane)');
    go.addEventListener('click', run);
    const recharge = !g.enough && g.loggedIn && (ctx.onRecharge ? h('button', { type: 'button', class: 'btn-ghost', onClick: () => ctx.onRecharge() }, 'Recharger') : h('a', { class: 'btn-ghost', href: '/dashboard/#credits' }, 'Recharger'));
    card.replaceChildren(
      h('div', { class: 'gen-head' }, h('span', { class: 'gen-coin', 'aria-hidden': 'true' }), h('div', {}, h('strong', {}, g.label || 'Ton CV'), h('small', {}, line))),
      h('div', { class: 'msg-card-row' }, go, recharge, !g.loggedIn && h('a', { class: 'btn-ghost', href: here() }, 'Se connecter')),
    );
  };
  async function run() {
    const ring = h('div', { class: 'gen-ring', style: '--p:12' });
    const now = h('span', {}, 'Mise en page…');
    card.replaceChildren(h('div', { class: 'gen-progress' }, ring, now));
    let p = 12;
    const creep = setInterval(() => ring.style.setProperty('--p', String((p = Math.min(88, p + (88 - p) * 0.12)))), 250);
    const state = ctx.renderState?.(g.version);
    const { data } = await callRender({ state, formats: ['pdf'] });
    clearInterval(creep);
    if (!data.ok) {
      card.replaceChildren(h('p', { class: 'gen-error' }, data.error || 'La préparation a échoué. Aucun crédit n’a été utilisé.'));
      const retry = h('button', { type: 'button', class: 'btn-ghost' }, 'Réessayer');
      retry.addEventListener('click', idle);
      card.append(retry);
      return;
    }
    if (data.balance != null) ctx.onSpent?.(data.balance);
    ring.style.setProperty('--p', '100');
    const wm = data.files.pdf.watermarked;
    const blob = toBlob(data.files.pdf.base64, MIME.pdf);
    const dl = h('button', { type: 'button', class: 'btn-primary gen-dl' }, `Télécharger le PDF${wm ? ' (filigrane)' : ''}`);
    dl.addEventListener('click', () => save(blob, `CV-${name()}.pdf`));
    card.replaceChildren(h('div', { class: 'gen-ready' }, h('span', { class: 'gen-check', 'aria-hidden': 'true' }), h('strong', {}, wm ? 'Ton CV est prêt (avec filigrane)' : 'Ton CV est prêt')), dl);
    ctx.onReady?.({ watermarked: wm });
  }
  idle();
  return card;
}
