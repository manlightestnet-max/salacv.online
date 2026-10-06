// Acheter des crédits : les packs (prix fixés dans l'admin, prix barré en promo) et le paiement LightPay
// (wallet LightPay ou mobile money) dans un dialogue, sans quitter salacv. Si le dialogue ne peut pas
// s'ouvrir, on passe par la page LightPay, qui ramène ici (/dashboard/?order=…#credits).
import { h } from './dom.js';
import { shop } from './lib/store.js';

const fcfa = (n) => `${Number(n).toLocaleString('fr-FR')} FCFA`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Suit la commande jusqu'à une réponse : le serveur relit l'état chez LightPay à chaque appel.
export async function followOrder(orderId, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const r = await shop.order(orderId);
    if (r.ok && r.order.status !== 'PENDING') return r.order;
    await wait(1500);
  }
  return { id: orderId, status: 'PENDING' };
}

const RESULT = {
  PAID: (o) => `Paiement confirmé : ${plural(o.credits, 'crédit')} ajouté${o.credits > 1 ? 's' : ''}.`,
  PENDING: () => 'Paiement en cours de confirmation. Tes crédits arrivent dès que LightPay le valide.',
  EXPIRED: () => 'Le paiement a expiré. Aucun montant n’a été pris.',
  CANCELLED: () => 'Paiement annulé. Aucun montant n’a été pris.',
  FAILED: () => 'Le paiement n’a pas abouti. Réessaie.',
};
export const orderMessage = (o) => (RESULT[o.status] ?? RESULT.FAILED)(o);

// Le bloc « Acheter des crédits ». onDone(order) : la commande a une issue (payée ou non).
export async function buyPanel({ keyAccount = false, onDone } = {}) {
  const panel = h('div', { class: 'panel buy' }, h('strong', {}, 'Acheter des crédits'));
  if (keyAccount) {
    panel.append(h('p', {}, 'L’achat de crédits se fait avec un compte Google : connecte-toi avec Google sur salacv.'));
    return panel;
  }
  const info = await shop.packs();
  if (!info.ok || !info.packs?.length) {
    panel.append(h('p', {}, info.ok ? 'Aucun pack en vente pour le moment.' : info.error));
    return panel;
  }
  if (!info.open) {
    panel.append(h('p', {}, 'Le paiement ouvre bientôt.'));
    return panel;
  }

  const note = h('p', { class: 'buy-note', role: 'status' });
  let busy = false;
  const buy = async (pack, btn) => {
    if (busy) return; // un seul achat à la fois, même en appuyant plusieurs fois
    busy = true;
    panel.classList.add('busy');
    btn.setAttribute('aria-busy', 'true');
    note.textContent = 'Ouverture du paiement…';
    try {
      const r = await shop.buy(pack.id);
      if (!r.ok) {
        note.textContent = r.error;
        return;
      }
      let LightPay;
      try {
        LightPay = await loadSdk(info.checkoutUrl);
      } catch {
        location.href = r.checkoutUrl; // pas de dialogue : la page LightPay, qui ramène ici
        return;
      }
      note.textContent = '';
      await LightPay.pay(r.checkoutUrl, { theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' }).catch(() => null);
      note.textContent = 'Vérification du paiement…';
      const order = await followOrder(r.order, 8);
      if (order.status === 'PENDING') {
        // Fermé sans payer, ou paiement mobile money pas encore validé : on ne bloque pas l'écran.
        note.textContent = 'Paiement non terminé. Si tu as validé sur ton téléphone, tes crédits arrivent dans un instant.';
        followOrder(r.order, 40).then((o) => o.status === 'PAID' && onDone?.(o));
        return;
      }
      note.textContent = orderMessage(order);
      onDone?.(order);
    } finally {
      busy = false;
      panel.classList.remove('busy');
      btn.removeAttribute('aria-busy');
    }
  };

  const packs = info.packs.map((p) => {
    const price = p.promoPrice ?? p.price;
    const btn = h(
      'button',
      { type: 'button', class: 'pack', 'aria-label': `${plural(p.credits, 'crédit')} pour ${fcfa(price)}` },
      h('span', { class: 'pack-credits' }, h('strong', {}, String(p.credits)), h('small', {}, p.credits > 1 ? 'crédits' : 'crédit')),
      h('span', { class: 'pack-price' }, h('strong', {}, fcfa(price)), p.promoPrice && h('s', {}, fcfa(p.price))),
      p.promoPrice && h('span', { class: 'pack-promo' }, `−${Math.round((1 - p.promoPrice / p.price) * 100)} %`),
    );
    btn.addEventListener('click', () => buy(p, btn));
    return btn;
  });
  panel.append(
    h('p', {}, 'Paie avec ton wallet LightPay ou par MTN MoMo / Airtel Money.'),
    h('div', { class: 'packs' }, packs),
    note,
    info.test && h('p', { class: 'mono' }, 'Mode test : aucun argent réel.'),
  );
  return panel;
}
