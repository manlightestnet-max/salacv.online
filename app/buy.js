// Recharger des crédits : un bouton ouvre la feuille des packs (prix fixés dans l'admin, prix barré en promo),
// le paiement se fait dans le dialogue LightPay (wallet, MTN MoMo, Airtel Money), puis la feuille suit la
// commande jusqu'au bout : confirmation en direct, crédits ajoutés, solde à jour.
// Si le dialogue ne peut pas s'ouvrir, on passe par la page LightPay, qui ramène ici (/dashboard/?order=…#credits).
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { shop } from './lib/store.js';

const fcfa = (n) => `${Number(n).toLocaleString('fr-FR')} FCFA`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const priceOf = (p) => p.promoPrice ?? p.price;

// --- Commande en cours (survit à un rechargement de page ou au retour depuis LightPay) ------------
const PENDING = 'salacv:pendingOrder';
const remember = (id) => {
  try {
    sessionStorage.setItem(PENDING, id);
  } catch {}
};
const forget = () => {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {}
};
export const pendingOrder = () => {
  try {
    return sessionStorage.getItem(PENDING);
  } catch {
    return null;
  }
};

// Attente qui se termine aussi quand la page redevient visible (retour de l'app MoMo) ou qu'on la presse.
const nap = (ms, wake) =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
      wake?.removeEventListener('wake', done);
      resolve();
    };
    const onVisible = () => document.visibilityState === 'visible' && done();
    const t = setTimeout(done, ms);
    document.addEventListener('visibilitychange', onVisible);
    wake?.addEventListener('wake', done);
  });

/**
 * Suit la commande jusqu'à une issue : chaque appel fait relire l'état chez LightPay par le serveur.
 * Rapide d'abord (1 s pendant 20 s), puis toutes les 3 s jusqu'à `maxMs`. `wake` : EventTarget pour vérifier tout de suite.
 */
export async function followOrder(orderId, { maxMs = 180_000, wake } = {}) {
  const start = Date.now();
  for (let i = 0; Date.now() - start < maxMs; i++) {
    const r = await shop.order(orderId);
    if (r.ok && r.order.status !== 'PENDING') {
      forget();
      return { ...r.order, balance: r.balance };
    }
    await nap(i < 20 ? 1000 : 3000, wake);
  }
  return { id: orderId, status: 'PENDING' };
}

const RESULT = {
  PAID: (o) => `${plural(o.credits, 'crédit')} ajouté${o.credits > 1 ? 's' : ''}.`,
  PENDING: () => 'Paiement en attente de confirmation.',
  EXPIRED: () => 'Paiement expiré. Aucun montant n’a été pris.',
  CANCELLED: () => 'Paiement annulé. Aucun montant n’a été pris.',
  FAILED: () => 'Le paiement n’a pas abouti.',
};
export const orderMessage = (o) => (RESULT[o.status] ?? RESULT.FAILED)(o);

// lightpay.js vient du domaine des pages de paiement LightPay ; chargé une seule fois.
let sdk = null;
function loadSdk(checkoutUrl) {
  if (window.LightPay) return Promise.resolve(window.LightPay);
  sdk ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: `${checkoutUrl}/lightpay.js`, async: true });
    s.onload = () => (window.LightPay ? resolve(window.LightPay) : reject(new Error('lightpay.js')));
    s.onerror = () => {
      sdk = null;
      reject(new Error('lightpay.js'));
    };
    document.head.append(s);
  });
  return sdk;
}

// --- Écrans de la feuille ---------------------------------------------------------------------

const coin = (big) => h('span', { class: big ? 'coin coin-lg' : 'coin', 'aria-hidden': 'true' });

function packTile(p, { best, selected, onSelect }) {
  const price = priceOf(p);
  const off = p.promoPrice ? Math.round((1 - p.promoPrice / p.price) * 100) : 0;
  const tile = h(
    'button',
    { type: 'button', role: 'radio', 'aria-checked': String(selected), class: `pack-tile${selected ? ' on' : ''}` },
    best && h('span', { class: 'pack-flag' }, 'Meilleur prix'),
    off > 0 && !best && h('span', { class: 'pack-flag promo' }, `−${off} %`),
    h('span', { class: 'pack-amount' }, coin(), h('strong', {}, String(p.credits))),
    h('span', { class: 'pack-unit' }, p.credits > 1 ? 'crédits' : 'crédit'),
    h('span', { class: 'pack-cost' }, h('strong', {}, fcfa(price)), p.promoPrice && h('s', {}, fcfa(p.price))),
    h('span', { class: 'pack-each' }, `${Math.round(price / p.credits).toLocaleString('fr-FR')} FCFA / crédit`),
  );
  tile.addEventListener('click', onSelect);
  return tile;
}

function state(kind, title, text, ...actions) {
  return h(
    'div',
    { class: `shop-state ${kind}` },
    h('span', { class: 'shop-badge', 'aria-hidden': 'true' }),
    h('strong', {}, title),
    text && h('p', {}, text),
    actions.length > 0 && h('div', { class: 'shop-actions' }, actions),
  );
}

// Petite fête à la réussite (désactivée avec prefers-reduced-motion, en CSS).
function burst() {
  const wrap = h('span', { class: 'burst', 'aria-hidden': 'true' });
  for (let i = 0; i < 14; i++) {
    const dot = h('i');
    dot.style.setProperty('--a', `${(360 / 14) * i}deg`);
    dot.style.setProperty('--d', `${60 + (i % 3) * 18}px`);
    wrap.append(dot);
  }
  setTimeout(() => wrap.remove(), 1200);
  return wrap;
}

/**
 * Ouvre la feuille « Recharger ». onPaid(order) : crédits ajoutés (le tableau de bord met le solde à jour).
 * keyAccount : compte « clé » (app PC sans Google), qui ne peut pas acheter.
 */
export async function openShop({ keyAccount = false, onPaid } = {}) {
  const body = h('div', { class: 'shop' }, h('div', { class: 'pack-grid' }, [0, 1, 2].map(() => h('span', { class: 'pack-tile skeleton' }))));
  const tag = h('span', { class: 'test-tag', hidden: true }, 'Test');
  const sheet = openDialog({ title: h('span', { class: 'shop-title' }, 'Recharger', tag), content: body, className: 'shop-sheet' });
  const show = (...nodes) => body.replaceChildren(...nodes);

  if (keyAccount) return show(state('info', 'Avec un compte Google', 'L’achat de crédits se fait connecté avec Google.'));
  const info = await shop.packs();
  if (!info.ok) return show(state('error', 'Boutique indisponible', info.error));
  tag.hidden = !info.test;
  if (!info.open || !info.packs?.length) return show(state('info', 'Bientôt disponible', 'La recharge de crédits ouvre très vite.'));

  const packs = [...info.packs].sort((a, b) => a.credits - b.credits);
  const each = (p) => priceOf(p) / p.credits;
  const cheapest = packs.reduce((a, b) => (each(b) < each(a) ? b : a));
  const best = packs.some((p) => each(p) > each(cheapest)) ? cheapest.id : null;
  let selected = (best && packs.find((p) => p.id === best)) || packs[Math.floor(packs.length / 2)];

  const choose = () => {
    const grid = h(
      'div',
      { class: 'pack-grid', role: 'radiogroup', 'aria-label': 'Packs de crédits' },
      packs.map((p) => packTile(p, { best: p.id === best, selected: p.id === selected.id, onSelect: () => ((selected = p), choose()) })),
    );
    const error = h('p', { class: 'shop-error', role: 'alert' });
    const cta = h('button', { type: 'button', class: 'shop-cta' }, `Payer ${fcfa(priceOf(selected))}`);
    cta.addEventListener('click', () => pay(cta, error));
    show(grid, cta, error, h('p', { class: 'shop-trust' }, h('span', { class: 'lock', 'aria-hidden': 'true' }), 'MTN MoMo · Airtel Money · Wallet LightPay'));
  };

  let busy = false;
  async function pay(cta, error) {
    if (busy) return; // un seul achat à la fois, même en appuyant plusieurs fois
    busy = true;
    cta.disabled = true;
    cta.classList.add('loading');
    cta.textContent = 'Ouverture du paiement…';
    error.textContent = '';
    try {
      const r = await shop.buy(selected.id);
      if (!r.ok) {
        error.textContent = r.error;
        return;
      }
      remember(r.order);
      let LightPay;
      try {
        LightPay = await loadSdk(info.checkoutUrl);
      } catch {
        location.href = r.checkoutUrl; // pas de dialogue : la page LightPay, qui ramène ici
        return;
      }
      const result = await LightPay.pay(r.checkoutUrl, { theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' }).catch(() => null);
      await track(r.order, result?.status === 'completed');
    } finally {
      busy = false;
      if (cta.isConnected) {
        cta.disabled = false;
        cta.classList.remove('loading');
        cta.textContent = `Payer ${fcfa(priceOf(selected))}`;
      }
    }
  }

  // Après le dialogue : confirmation en direct, puis réussite, attente (MoMo à valider) ou échec.
  async function track(orderId, completed) {
    const wake = new EventTarget();
    show(state('checking', 'Confirmation du paiement…', completed ? 'C’est presque fini.' : 'Si tu as validé sur ton téléphone, ça arrive.'));
    // Fermé sans payer : on ne bloque pas l'écran longtemps, le suivi continue en arrière-plan.
    const following = followOrder(orderId, { wake });
    const quick = await Promise.race([following, nap(completed ? 30_000 : 6_000).then(() => null)]);
    const order = quick ?? (await waiting(following, wake));
    if (!order) return;
    finish(order);
  }

  function waiting(following, wake) {
    const again = h('button', { type: 'button', class: 'shop-cta ghost' }, 'J’ai validé sur mon téléphone');
    again.addEventListener('click', () => wake.dispatchEvent(new Event('wake')));
    const later = h('button', { type: 'button', class: 'shop-link' }, 'Fermer');
    later.addEventListener('click', () => sheet.close());
    show(state('pending', 'En attente de ta validation', 'Valide le paiement sur ton téléphone. Tes crédits arrivent dès que c’est confirmé.', again, later));
    // Le suivi continue même si la feuille est fermée : le solde se met à jour tout seul.
    return following.then((order) => {
      if (sheet.el.isConnected) return order;
      if (order.status === 'PAID') onPaid?.(order);
      return null;
    });
  }

  function finish(order) {
    if (order.status === 'PAID') {
      onPaid?.(order);
      const done = h('button', { type: 'button', class: 'shop-cta' }, 'Continuer');
      done.addEventListener('click', () => sheet.close());
      const view = state('success', `+${plural(order.credits, 'crédit')}`, `Tu as maintenant ${plural(order.balance, 'crédit')}.`, done);
      view.querySelector('.shop-badge').append(burst());
      return show(view);
    }
    if (order.status === 'PENDING') return; // déjà géré par waiting()
    const retry = h('button', { type: 'button', class: 'shop-cta' }, 'Réessayer');
    retry.addEventListener('click', choose);
    show(state('error', 'Paiement non abouti', orderMessage(order), retry));
  }

  choose();
}
