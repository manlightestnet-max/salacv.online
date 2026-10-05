// Assistant : connexion (fictive, vérifiée côté serveur) puis discussion. L'agent
// reçoit le CV du formulaire, le modifie et le renvoie ; le formulaire et l'aperçu
// se mettent à jour, l'étudiant peut tout corriger à la main ensuite.
import { h } from './dom.js';
import { markdown } from './markdown.js';
import { loginPanel } from './login.js';
import { publishQuota } from './quotabar.js';
import { forgetSession, getSession, logout } from './session.js';

const HISTORY_SENT = 6; // derniers échanges envoyés pour les demandes de suivi

const SUGGESTIONS = [
  { label: 'Remplir mon CV', text: "Voici mes infos : je m'appelle …, j'ai étudié … à … de … à …, j'ai fait un stage chez … où j'ai …" },
  { label: 'Écrire mon profil', text: 'Écris mon profil professionnel à partir de mon CV.' },
  { label: 'Reformuler mes expériences', text: 'Reformule mes expériences avec des verbes d’action, sans rien inventer.' },
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
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, data: { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' } };
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
  return { status: res.status, data };
}

// ctx : { getState(), setState(state), onClose() }
export function createAgentPanel(ctx) {
  let session = getSession(); // l'identité vient du serveur (cookie httpOnly) : aucun jeton dans la page
  let chat = []; // le fil de discussion reste en mémoire : plus rien n'est gardé dans le navigateur
  let pending = false;

  const root = h('div', { class: 'agent' });

  function render() {
    // Web : l'assistant marche sans compte (clés publiques, quota). App desktop : connexion obligatoire.
    root.replaceChildren(session || !window.desktop?.isDesktop ? chatView() : loginView());
  }

  function header(subtitle, action) {
    return h(
      'div',
      { class: 'agent-head' },
      h('button', { class: 'btn-text agent-back', type: 'button', onClick: ctx.onClose }, '‹ Formulaire'),
      h('div', { class: 'agent-head-title' }, subtitle && h('span', {}, subtitle)),
      action,
    );
  }

  // --- Connexion ------------------------------------------------------------

  function loginView() {
    const panel = loginPanel({
      intro: window.desktop?.isDesktop
        ? "L'assistant remplit ton CV à partir de ce que tu lui écris. Il est réservé aux comptes connectés : Google, ou une clé en ligne."
        : "L'assistant remplit ton CV à partir de ce que tu lui écris. Il est réservé aux comptes connectés avec Google.",
      onDone: (r) => {
        if (r?.kind === 'offline') return; // une clé hors ligne ouvre l'app, pas l'assistant (il demande un compte)
        session = getSession();
        render();
      },
    });
    return h('div', { class: 'agent-inner' }, header('Connexion'), h('div', { class: 'agent-scroll' }, h('div', { class: 'agent-login' }, h('div', { class: 'step-head' }, h('h2', {}, 'Connecte-toi')), panel)));
  }

  // --- Discussion -----------------------------------------------------------

  function bubble(msg) {
    // Réponses de l'agent en markdown ; messages de l'étudiant en texte brut.
    const body = msg.role === 'assistant' && !msg.error ? markdown(msg.text) : [h('p', {}, msg.text)];
    const node = h('div', { class: `msg msg-${msg.role}${msg.error ? ' msg-error' : ''}` }, body);
    if (msg.changes?.length) {
      node.append(
        h('div', { class: 'msg-changes' }, h('span', { 'aria-hidden': 'true' }, '✓'), h('span', {}, `Mis à jour : ${msg.changes.map((c) => CHANGE_LABELS[c] ?? c).join(', ')}`)),
      );
    }
    return node;
  }

  function chatView() {
    const list = h('div', { class: 'agent-messages', 'aria-live': 'polite' });
    const input = h('textarea', {
      class: 'input agent-input',
      rows: 2,
      placeholder: 'Tes infos, ou « ajoute Excel »…',
      'aria-label': "Message pour l'assistant",
    });
    const send = h('button', { class: 'btn-primary agent-send', type: 'submit', 'aria-label': 'Envoyer', title: 'Envoyer (Entrée)' }, '↑');

    const intro = {
      role: 'assistant',
      text: `Salut${session ? ` ${session.username}` : ''} ! Écris-moi tes infos (études, stages, compétences, langues) même en vrac, ou dis-moi quoi changer. Je remplis ton CV, et tu pourras tout corriger ensuite.`,
    };
    list.append(bubble(intro), ...chat.map(bubble));

    const suggestions = h(
      'div',
      { class: 'agent-suggestions' },
      SUGGESTIONS.map((s) =>
        h('button', {
          class: 'pill-option',
          type: 'button',
          onClick: () => {
            input.value = s.text;
            input.focus();
            autosize();
          },
        }, s.label),
      ),
    );
    suggestions.hidden = chat.length > 0;

    function autosize() {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    }

    function scrollDown() {
      requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
    }

    function push(msg) {
      if (!msg.error) {
        chat.push(msg);
        chat = chat.slice(-30);
      }
      list.append(bubble(msg));
      scrollDown();
    }

    async function submit(e) {
      e?.preventDefault();
      const text = input.value.trim();
      if (!text || pending) return;
      const history = chat.slice(-HISTORY_SENT).map((m) => ({ role: m.role, text: m.text }));
      push({ role: 'user', text });
      input.value = '';
      autosize();
      suggestions.hidden = true;

      pending = true;
      send.disabled = true;
      const typing = h('div', { class: 'msg msg-assistant msg-typing' }, h('span'), h('span'), h('span'), h('em', {}, 'Je remplis ton CV…'));
      list.append(typing);
      scrollDown();

      const { status, data } = await post('/api/agent', { state: ctx.getState(), message: text, history });
      typing.remove();
      pending = false;
      send.disabled = false;

      publishQuota(data.quota);
      if (status === 401) {
        session = null;
        forgetSession();
        render();
        return;
      }
      if (!data.ok) {
        push({ role: 'assistant', text: data.error || 'Une erreur est survenue. Réessaie.', error: true });
        return;
      }
      if (data.state) ctx.setState(data.state);
      push({ role: 'assistant', text: data.reply || 'C’est fait.', changes: data.changes });
      input.focus();
    }

    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      // Entrée envoie ; Maj+Entrée va à la ligne (sur mobile, le bouton Envoyer).
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) submit(e);
    });

    const logout = h(
      'button',
      {
        class: 'btn-text agent-logout',
        type: 'button',
        onClick: () => {
          session = null;
          chat = [];
          logout().then(() => location.reload());
        },
      },
      'Déconnexion',
    );

    scrollDown();
    return h(
      'div',
      { class: 'agent-inner' },
      header(session ? session.username : 'Assistant', session ? logout : h('a', { class: 'btn-text agent-logout', href: `/auth/?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Se connecter')),
      list,
      h('form', { class: 'agent-compose', onSubmit: submit }, suggestions, h('div', { class: 'agent-compose-row' }, input, send)),
    );
  }

  render();
  return { el: root, focus: () => root.querySelector('textarea, input')?.focus() };
}
