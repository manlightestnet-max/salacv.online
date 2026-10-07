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
import { MIME, callRender, save, slug, toBlob } from './export.js';
import { formatCredits } from './lib/store.js';

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
  { label: 'Importer mon CV', importCv: true },
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
  let askFn = null; // envoyer une demande venue d'ailleurs (landing : « Dis-moi qui tu es »)

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
  // Générer dans le chat : l'utilisateur touche « Générer », la carte montre l'avancement, puis « Télécharger ».
  // Le serveur revérifie et débite (un crédit pour une nouvelle version propre) ; sans crédit, filigrane.
  function generateCard(g) {
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
      card.replaceChildren(
        h('div', { class: 'gen-head' }, h('span', { class: 'gen-coin', 'aria-hidden': 'true' }), h('div', {}, h('strong', {}, g.label || 'Ton CV'), h('small', {}, line))),
        h(
          'div',
          { class: 'msg-card-row' },
          go,
          !g.enough && g.loggedIn && h('a', { class: 'btn-ghost', href: '/dashboard/#credits' }, 'Recharger'),
          !g.loggedIn && h('a', { class: 'btn-ghost', href: here() }, 'Se connecter'),
        ),
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
    }
    idle();
    return card;
  }

  // Modèles proposés par l'IA : SON CV dessiné dans chaque modèle ; un toucher l'applique, puis on propose de générer.
  function templatesCard(msg) {
    const wrap = h('div', { class: 'chat-tpls' });
    const offer = h('div', { class: 'chat-tpl-offer' });
    const tiles = msg.templates.map((t) => {
      const tile = h(
        'button',
        { type: 'button', class: 'chat-tpl', 'aria-pressed': String(msg.templateChosen === t.id) },
        h('span', { class: 'chat-tpl-paper' }, ctx.templateThumb?.(t.id, 120) ?? null, h('span', { class: 'tpl-check', 'aria-hidden': 'true' })),
        h('strong', {}, t.name),
        t.reason && h('small', {}, t.reason),
      );
      tile.addEventListener('click', async () => {
        ctx.pickTemplate?.(t.id);
        msg.templateChosen = t.id;
        ctx.setChat?.(chat);
        tiles.forEach((x, i) => x.setAttribute('aria-pressed', String(msg.templates[i].id === t.id)));
        offer.replaceChildren(h('p', { class: 'chat-tpl-q' }, `${t.name} appliqué. Je génère ton CV ?`));
        const info = await ctx.generateInfo?.();
        if (info && msg.templateChosen === t.id) offer.append(generateCard(info));
      });
      return tile;
    });
    wrap.append(h('div', { class: 'chat-tpl-row' }, tiles), offer);
    return wrap;
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
    if (msg.pending) node.append(pendingCard(msg, node));
    if (msg.templates?.length) node.append(templatesCard(msg));
    return node;
  }

  // Changement qui retire ou remplace ce que l'utilisateur a écrit : rien n'est fait tant qu'il ne confirme pas.
  // Le serveur l'a signé ; il ne s'applique que sur le CV tel qu'il était, sans nouvel appel à l'IA.
  function pendingCard(msg, node) {
    if (msg.pendingDone) {
      return h('div', { class: `msg-confirm done${msg.pendingDone === 'no' ? ' no' : ''}` }, h('span', {}, msg.pendingDone === 'no' ? 'Changement annulé' : 'Changement confirmé'));
    }
    const yes = h('button', { type: 'button', class: 'btn-primary' }, 'Confirmer');
    const no = h('button', { type: 'button', class: 'btn-ghost' }, 'Non merci');
    const error = h('p', { class: 'msg-confirm-error', role: 'alert', hidden: true });
    const card = h(
      'div',
      { class: 'msg-confirm' },
      h('strong', {}, msg.pending.lines.length > 1 ? 'À confirmer' : 'À confirmer'),
      h('ul', {}, msg.pending.lines.map((l) => h('li', {}, l))),
      error,
      h('div', { class: 'msg-card-row' }, yes, no),
    );
    const settle = (how) => {
      msg.pendingDone = how;
      ctx.setChat?.(chat);
      card.replaceWith(pendingCard(msg, node));
    };
    no.addEventListener('click', () => settle('no'));
    yes.addEventListener('click', async () => {
      yes.disabled = no.disabled = true;
      yes.classList.add('loading');
      const snap = ctx.snapshot?.();
      const { data } = await post('/api/agent', { state: ctx.getState(), confirm: msg.pending });
      if (!data.ok) {
        yes.disabled = no.disabled = false;
        yes.classList.remove('loading');
        error.hidden = false;
        error.textContent = data.error || 'Impossible pour l’instant. Réessaie.';
        return;
      }
      ctx.setState(data.state);
      msg.changes = [...new Set([...(msg.changes ?? []), ...(data.changes ?? [])])];
      settle('ok');
      const changes = node.querySelector('.msg-changes');
      const fresh = bubble({ ...msg, pending: null }).querySelector('.msg-changes');
      if (fresh) (changes ? changes.replaceWith(fresh) : node.insertBefore(fresh, node.querySelector('.msg-confirm')));
      if (snap) offerUndo(node, msg, snap);
    });
    return card;
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

    // Accueil : l'IA est la porte d'entrée. Trois façons de commencer, en grandes tuiles.
    const START = [
      { cls: 'import', title: 'Importer mon CV', sub: 'PDF ou photo : je lis tout', run: () => ctx.importCv?.() },
      { cls: 'photo', title: 'Photo d’un document', sub: 'Diplôme, attestation, capture', run: () => file.click() },
      {
        cls: 'talk',
        title: 'Raconter mon parcours',
        sub: 'En vrac, avec tes mots',
        run: () => {
          input.value = 'Je m’appelle …, je suis … J’ai étudié … à … (de … à …). J’ai travaillé chez … comme … : …';
          input.focus();
          autosize();
        },
      },
    ];
    const intro = h(
      'div',
      { class: 'agent-intro' },
      h('span', { class: 'agent-intro-mark', 'aria-hidden': 'true' }, '✦'),
      h('strong', {}, 'On fait ton CV ensemble'),
      h('p', {}, 'Je lis, j’écris et je mets en page. Tu valides tout, et tu peux toujours annuler.'),
      chat.length === 0 &&
        h(
          'div',
          { class: 'agent-start' },
          START.map((s) => h('button', { type: 'button', class: `agent-start-tile ${s.cls}`, onClick: s.run }, h('strong', {}, s.title), h('small', {}, s.sub), h('span', { class: 'agent-start-shine', 'aria-hidden': 'true' }))),
        ),
    );
    list.append(intro, ...chat.map(bubble));

    const suggestions = h(
      'div',
      { class: 'agent-suggestions' },
      SUGGESTIONS.map((s) =>
        h('button', { class: 'agent-chip', type: 'button', onClick: () => (s.importCv ? ctx.importCv?.() : s.image ? file.click() : ((input.value = s.text), input.focus(), autosize(), (send.disabled = false))) }, s.label),
      ),
    );
    suggestions.hidden = true; // l'accueil (tuiles) remplace les suggestions
    askFn = (text) => {
      input.value = String(text ?? '').slice(0, 2000);
      autosize();
      submit();
    };

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
      intro.querySelector('.agent-start')?.remove();

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
      const msg = { role: 'assistant', text: data.reply || (changed ? 'C’est fait.' : 'D’accord.'), changes: data.changes ?? [], ...(data.generate ? { generate: data.generate } : {}), ...(data.pending ? { pending: data.pending } : {}), ...(data.templates ? { templates: data.templates } : {}) };
      const node = push(msg);
      if (changed && snap) offerUndo(node, msg, snap);
      // Générer dépense un crédit : jamais l'IA seule, la carte attend que l'utilisateur touche le bouton.
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
  return { el: root, focus: () => window.matchMedia('(hover: hover)').matches && root.querySelector('textarea, input')?.focus(), ask: (text) => askFn?.(text) };
}
