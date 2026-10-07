// Assistant du CV : une conversation par CV (gardée avec lui), lisible, et sûre.
//   • il ne modifie que si on le lui demande ; après chaque modification, « Annuler les modifications » remet le CV
//     tel qu'il était (seule la dernière modification garde ce bouton : un nouveau changement le reprend) ;
//   • il peut consulter les personnalités et générer le CV sur demande : la préparation habituelle s'ouvre et le
//     SERVEUR revérifie et débite les crédits (aucun contournement par l'assistant) ; pas assez : on propose de recharger.
import { h } from './dom.js';
import { markdown } from './markdown.js';
import { loginPanel } from './login.js';
import { publishQuota } from './quotabar.js';
import { forgetSession, getSession } from './session.js';

const HISTORY_SENT = 6; // derniers échanges envoyés pour les demandes de suivi

// Image jointe : réduite dans le navigateur avant l'envoi (moins de données, moins de tokens), en JPEG.
const IMAGE_MAX_SIDE = 1600;
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Image illisible.');
  const ratio = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // une capture transparente reste lisible
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 1_500_000) return url;
  }
  throw new Error('Image trop lourde.');
}

const SUGGESTIONS = [
  { label: 'Remplir mon CV', text: "Voici mes infos à mettre dans mon CV : je m'appelle …, j'ai étudié … à … de … à …, j'ai fait un stage chez … où j'ai …" },
  { label: 'Depuis une photo', image: true },
  { label: 'Que manque-t-il ?', text: 'Qu’est-ce qui manque à mon CV ? Ne modifie rien, dis-le-moi.' },
  { label: 'Écrire mon profil', text: 'Écris mon profil professionnel à partir de mon CV.' },
  { label: 'Générer mon CV', text: 'Génère mon CV en PDF.' },
];

const CHANGE_LABELS = {
  identité: 'Identité',
  'profil professionnel': 'Profil',
  'formation & certifications': 'Formation',
  'expérience professionnelle': 'Expérience',
  'compétences & certifications': 'Compétences',
  langues: 'Langues',
  loisirs: 'Loisirs',
};

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { status: 0, data: { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' } };
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
  return { status: res.status, data };
}

const here = () => `/auth/?next=${encodeURIComponent(location.pathname + location.search)}`;

// ctx : { getState(), setState(state), onClose(), getChat(), setChat(chat), snapshot(), restore(snap), getContext(), generate(key) }
export function createAgentPanel(ctx) {
  let session = getSession(); // l'identité vient du serveur (cookie httpOnly) : aucun jeton dans la page
  let chat = [...(ctx.getChat?.() ?? [])]; // la conversation de CE CV
  let pending = false;
  let undo = null; // { snap, node } : la dernière modification annulable

  const root = h('div', { class: 'agent' });

  function render() {
    // Web : l'assistant marche sans compte (clés publiques, quota). App desktop : connexion obligatoire.
    root.replaceChildren(session || !window.desktop?.isDesktop ? chatView() : loginView());
  }

  function header(subtitle, action) {
    return h(
      'div',
      { class: 'agent-head' },
      h('button', { class: 'agent-back', type: 'button', onClick: ctx.onClose, 'aria-label': 'Revenir au formulaire' }, '‹ Formulaire'),
      h('div', { class: 'agent-head-title' }, h('strong', {}, 'Assistant'), subtitle && h('span', {}, subtitle)),
      action,
    );
  }

  // --- Connexion (app desktop) ---------------------------------------------------

  function loginView() {
    const panel = loginPanel({
      intro: "L'assistant remplit ton CV à partir de ce que tu lui écris. Il est réservé aux comptes connectés : Google, ou une clé en ligne.",
      onDone: (r) => {
        if (r?.kind === 'offline') return; // une clé hors ligne ouvre l'app, pas l'assistant (il demande un compte)
        session = getSession();
        render();
      },
    });
    return h('div', { class: 'agent-inner' }, header('Connexion'), h('div', { class: 'agent-scroll' }, h('div', { class: 'agent-login' }, panel)));
  }

  // --- Discussion ------------------------------------------------------------------

  // Crédits ou génération : une petite carte d'action sous la réponse.
  function generateCard(g) {
    if (g.enough) {
      return h(
        'div',
        { class: 'msg-card' },
        h('span', {}, `${g.label} · 1 crédit (il t’en reste ${g.balance})`),
        h('button', { type: 'button', class: 'btn-primary', onClick: () => ctx.generate?.(g.version) }, 'Préparer le PDF'),
      );
    }
    return h(
      'div',
      { class: 'msg-card buy' },
      h('strong', {}, g.loggedIn ? `Il te faut ${g.cost} crédit pour un PDF sans filigrane` : 'Connecte-toi pour un PDF sans filigrane'),
      h('span', {}, g.loggedIn ? `Solde : ${g.balance} crédit${g.balance > 1 ? 's' : ''}. Recharge pour le PDF propre et le Word.` : 'Sans compte, le PDF sort avec filigrane.'),
      h(
        'div',
        { class: 'msg-card-row' },
        g.loggedIn
          ? h('a', { class: 'btn-primary', href: '/dashboard/#credits' }, 'Recharger mes crédits')
          : h('a', { class: 'btn-primary', href: here() }, 'Se connecter'),
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => ctx.generate?.(g.version) }, 'PDF avec filigrane'),
      ),
    );
  }

  function bubble(msg) {
    // Réponses de l'agent en markdown ; messages de l'étudiant en texte brut.
    const body = msg.role === 'assistant' && !msg.error ? markdown(msg.text) : [msg.text && h('p', {}, msg.text)];
    if (msg.attached) body.unshift(h('span', { class: 'msg-attached' }, 'Image jointe'));
    const node = h('div', { class: `msg msg-${msg.role}${msg.error ? ' msg-error' : ''}` }, body);
    if (msg.changes?.length) {
      node.append(
        h(
          'div',
          { class: `msg-changes${msg.undone ? ' undone' : ''}` },
          h('span', { class: 'msg-changes-mark', 'aria-hidden': 'true' }, msg.undone ? '↺' : '✓'),
          h('span', {}, msg.undone ? 'Modifications annulées' : `Modifié : ${msg.changes.map((c) => CHANGE_LABELS[c] ?? c).join(', ')}`),
        ),
      );
    }
    if (msg.generate) node.append(generateCard(msg.generate));
    return node;
  }

  // Seule la dernière modification se laisse annuler : le bouton passe d'une réponse à la suivante.
  function offerUndo(node, msg, snap) {
    undo?.button.remove();
    const button = h('button', { type: 'button', class: 'msg-undo' }, '↺ Annuler les modifications');
    button.addEventListener('click', () => {
      ctx.restore?.(snap);
      msg.undone = true;
      ctx.setChat?.(chat);
      node.querySelector('.msg-changes')?.replaceWith(bubble(msg).querySelector('.msg-changes'));
      button.remove();
      undo = null;
    });
    node.append(button);
    undo = { button };
  }

  function chatView() {
    const list = h('div', { class: 'agent-messages', 'aria-live': 'polite' });
    const input = h('textarea', { class: 'agent-input', rows: 1, placeholder: 'Écris à l’assistant…', 'aria-label': "Message pour l'assistant" });
    const send = h('button', { class: 'agent-send', type: 'submit', 'aria-label': 'Envoyer', title: 'Envoyer' });
    // Joindre une image : galerie ou appareil photo ; l'IA la lit, remplit et demande ce qui manque.
    let image = null; // { url (données réduites), preview (adresse locale) }
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/heic,image/heif', hidden: true });
    const attach = h('button', { class: 'agent-attach', type: 'button', 'aria-label': 'Joindre une image', title: 'Joindre une image (ancien CV, diplôme, capture…)' });
    attach.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 2.5-2.5L20 18"/></svg>';
    attach.addEventListener('pointerdown', (e) => e.preventDefault());
    attach.addEventListener('click', () => file.click());
    const tray = h('div', { class: 'agent-tray', hidden: true });
    function setImage(next) {
      if (image?.preview) URL.revokeObjectURL(image.preview);
      image = next;
      tray.hidden = !image;
      tray.replaceChildren(
        ...(image
          ? [
              h('img', { src: image.preview, alt: 'Image jointe' }),
              h('span', {}, image.url ? 'Image prête : envoie-la, avec une consigne si tu veux.' : 'Préparation de l’image…'),
              h('button', { type: 'button', class: 'agent-tray-x', 'aria-label': 'Retirer l’image', onClick: () => (setImage(null), autosize()) }, '✕'),
            ]
          : []),
      );
      autosize();
    }
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const preview = URL.createObjectURL(f);
      setImage({ url: null, preview });
      try {
        const url = await shrinkImage(f);
        if (image?.preview === preview) setImage({ url, preview });
      } catch (err) {
        URL.revokeObjectURL(preview);
        setImage(null);
        push({ role: 'assistant', text: `${err.message} Essaie une autre photo ou une capture d’écran.`, error: true });
      }
    });
    send.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>';
    // Toucher Envoyer ne retire pas le focus du champ : le clavier reste ouvert et le message part au premier toucher
    // (avant, le premier toucher ne faisait que fermer le clavier, la mise en page bougeait et l'envoi était perdu).
    send.addEventListener('pointerdown', (e) => e.preventDefault());
    send.addEventListener('mousedown', (e) => e.preventDefault());

    const intro = h(
      'div',
      { class: 'agent-intro' },
      h('span', { class: 'agent-intro-mark', 'aria-hidden': 'true' }, '✦'),
      h('strong', {}, 'Je t’aide sur ce CV'),
      h('p', {}, 'Écris tes infos, même en vrac, ou pose une question. Je ne modifie rien sans que tu le demandes, et tu peux toujours annuler.'),
    );
    list.append(intro, ...chat.map(bubble));

    const suggestions = h(
      'div',
      { class: 'agent-suggestions' },
      SUGGESTIONS.map((s) =>
        h('button', { class: 'agent-chip', type: 'button', onClick: () => (s.image ? file.click() : ((input.value = s.text), input.focus(), autosize(), (send.disabled = false))) }, s.label),
      ),
    );
    suggestions.hidden = chat.length > 0;

    function autosize() {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
      send.disabled = pending || (!input.value.trim() && !image?.url);
    }
    const scrollDown = () => requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }));

    function push(msg) {
      if (!msg.error) {
        chat.push(msg);
        chat = chat.slice(-40);
        ctx.setChat?.(chat);
      }
      const node = bubble(msg);
      list.append(node);
      scrollDown();
      return node;
    }

    async function submit(e) {
      e?.preventDefault();
      const text = input.value.trim();
      const sentImage = image?.url ?? null;
      if ((!text && !sentImage) || pending || (image && !image.url)) return;
      const history = chat.slice(-HISTORY_SENT).map((m) => ({ role: m.role, text: m.text }));
      const mine = push({ role: 'user', text, ...(sentImage ? { attached: true } : {}) });
      // L'aperçu reste dans la bulle le temps de la session ; l'image n'est gardée ni dans la conversation ni sur le serveur.
      if (sentImage) mine.prepend(h('img', { class: 'msg-image', src: sentImage, alt: 'Image jointe' }));
      setImage(null);
      input.value = '';
      autosize();
      suggestions.hidden = true;

      pending = true;
      send.disabled = true;
      const typing = h('div', { class: 'msg msg-assistant msg-typing' }, h('span'), h('span'), h('span'));
      list.append(typing);
      scrollDown();

      const snap = ctx.snapshot?.();
      if (sentImage) typing.dataset.label = 'Je lis ton image…';
      const { status, data } = await post('/api/agent', { state: ctx.getState(), message: text, history, context: ctx.getContext?.(), ...(sentImage ? { image: sentImage } : {}) });
      typing.remove();
      pending = false;
      autosize();

      publishQuota(data.quota);
      if (status === 401) {
        session = null;
        forgetSession();
        render();
        return;
      }
      if (!data.ok) {
        const node = push({ role: 'assistant', text: data.error || 'Une erreur est survenue. Réessaie.', error: true });
        // Réserve vide : un lien direct vers Crédits (remise à zéro ou pack IA).
        if (data.code === 'AI_QUOTA') node.append(h('a', { class: 'btn-primary msg-cta', href: '/dashboard/#credits' }, 'Recharger mon IA'));
        return;
      }
      const changed = Boolean(data.changes?.length);
      if (changed && data.state) ctx.setState(data.state);
      const msg = { role: 'assistant', text: data.reply || (changed ? 'C’est fait.' : 'D’accord.'), changes: data.changes ?? [], ...(data.generate ? { generate: data.generate } : {}) };
      const node = push(msg);
      if (changed && snap) offerUndo(node, msg, snap);
      // Génération demandée et crédits suffisants : la préparation s'ouvre (le serveur décide au téléchargement).
      if (data.generate?.enough) ctx.generate?.(data.generate.version);
      if (window.matchMedia('(hover: hover)').matches) input.focus();
    }

    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      // Entrée envoie ; Maj+Entrée va à la ligne (sur mobile, le bouton Envoyer).
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) submit(e);
    });
    autosize();
    scrollDown();
    return h(
      'div',
      { class: 'agent-inner' },
      header(session ? 'Ce CV' : 'Visiteur', session ? null : h('a', { class: 'agent-login-link', href: here() }, 'Se connecter')),
      list,
      h('form', { class: 'agent-compose', onSubmit: submit }, suggestions, tray, h('div', { class: 'agent-compose-row' }, attach, file, input, send)),
    );
  }

  render();
  return { el: root, focus: () => window.matchMedia('(hover: hover)').matches && root.querySelector('textarea, input')?.focus() };
}
