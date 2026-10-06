// Côté navigateur : acheter, payer dans le dialogue LightPay, puis demander au serveur si c'est payé.
const CHECKOUT = 'https://checkout.smlab.xyz';
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let sdk = null;
const loadLightPay = () =>
  (sdk ??= new Promise((resolve, reject) => {
    if (window.LightPay) return resolve(window.LightPay);
    const s = Object.assign(document.createElement('script'), { src: `${CHECKOUT}/lightpay.js`, async: true });
    s.onload = () => resolve(window.LightPay);
    s.onerror = () => ((sdk = null), reject(new Error('lightpay.js')));
    document.head.append(s);
  }));

// Le serveur relit la session chez LightPay à chaque appel ; le mobile money peut valider un peu après.
async function follow(orderId, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const { status } = await post('/api/order', { orderId });
    if (status && status !== 'PENDING') return status;
    await wait(1500);
  }
  return 'PENDING';
}

const button = document.querySelector('#buy');
const note = document.querySelector('#note');

button.addEventListener('click', async () => {
  if (button.disabled) return;
  button.disabled = true; // un seul achat à la fois
  try {
    const r = await post('/api/buy', { product: 'ebook' });
    if (!r.checkoutUrl) return (note.textContent = r.error ?? 'Erreur');
    let LightPay;
    try {
      LightPay = await loadLightPay();
    } catch {
      return (location.href = r.checkoutUrl); // pas de dialogue : la page LightPay, retour sur return_url
    }
    const theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    await LightPay.pay(r.checkoutUrl, { theme }); // 'completed' n'est qu'un indice : on demande au serveur
    note.textContent = 'Vérification…';
    const status = await follow(r.order);
    note.textContent = status === 'PAID' ? 'Payé, merci !' : status === 'PENDING' ? 'Paiement non terminé.' : 'Paiement annulé ou expiré.';
  } finally {
    button.disabled = false;
  }
});

// Retour de la page LightPay (mode pleine page) : /?order=ord_…
const back = new URLSearchParams(location.search).get('order');
if (back) {
  history.replaceState(null, '', location.pathname);
  note.textContent = 'Vérification…';
  follow(back).then((s) => (note.textContent = s === 'PAID' ? 'Payé, merci !' : 'Paiement non confirmé.'));
}
