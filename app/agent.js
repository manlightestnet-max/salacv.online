// Assistant : connexion (fictive, vérifiée côté serveur) puis discussion. L'agent
// reçoit le CV du formulaire, le modifie et le renvoie ; le formulaire et l'aperçu
// se mettent à jour, l'étudiant peut tout corriger à la main ensuite.
import { h } from './dom.js';

const SESSION_KEY = 'salacv:session';
const CHAT_KEY = 'salacv:chat';
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

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : la session ne survit pas au rechargement
  }
}

async function post(url, body, token) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
  let session = read(SESSION_KEY);
  let chat = read(CHAT_KEY) ?? [];
  let pending = false;

  const root = h('div', { class: 'agent' });

  function render() {
    root.replaceChildren(session ? chatView() : loginView());
  }

  function header(subtitle, action) {
    return h(
      'div',
      { class: 'agent-head' },
      h('button', { class: 'btn-text agent-back', type: 'button', onClick: ctx.onClose }, '‹ Formulaire'),
      h('div', { class: 'agent-head-title' }, h('strong', {}, 'Assistant'), subtitle && h('span', {}, subtitle)),
      action,
    );
  }

  // --- Connexion ------------------------------------------------------------

  function loginView() {
    const error = h('p', { class: 'agent-error', role: 'alert', hidden: true });
    const username = h('input', { class: 'input', id: 'agent-user', autocomplete: 'username', placeholder: 'grace.mbuyi', required: true });
    const password = h('input', { class: 'input', id: 'agent-pass', type: 'password', autocomplete: 'current-password', placeholder: '6 caractères minimum', required: true });
    const submit = h('button', { class: 'btn-primary btn-lg', type: 'submit' }, 'Se connecter');

    const form = h(
      'form',
      {
        class: 'agent-login',
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          submit.textContent = 'Connexion…';
          error.hidden = true;
          const { data } = await post('/api/login', { username: username.value.trim(), password: password.value });
          submit.disabled = false;
          submit.textContent = 'Se connecter';
          if (!data.ok) {
            error.textContent = data.error || 'Connexion impossible.';
            error.hidden = false;
            return;
          }
          session = { token: data.token, username: data.username };
          write(SESSION_KEY, session);
          render();
          root.querySelector('textarea')?.focus();
        },
      },
      h('div', { class: 'step-head' }, h('h2', {}, 'Connecte-toi'), h('p', {}, "L'assistant remplit ton CV à partir de ce que tu lui écris. Il est réservé aux comptes connectés.")),
      h('div', { class: 'field' }, h('label', { for: 'agent-user' }, "Nom d'utilisateur"), username),
      h('div', { class: 'field' }, h('label', { for: 'agent-pass' }, 'Mot de passe'), password),
      error,
      submit,
    );
    requestAnimationFrame(() => username.focus());
    return h('div', { class: 'agent-inner' }, header(), h('div', { class: 'agent-scroll' }, form));
  }

  // --- Discussion -----------------------------------------------------------

  function bubble(msg) {
    const node = h('div', { class: `msg msg-${msg.role}${msg.error ? ' msg-error' : ''}` }, h('p', {}, msg.text));
    if (msg.changes?.length) {
      node.append(
        h('div', { class: 'msg-changes' }, h('span', {}, 'Modifié :'), msg.changes.map((c) => h('span', { class: 'msg-chip' }, CHANGE_LABELS[c] ?? c))),
      );
    }
    return node;
  }

  function chatView() {
    const list = h('div', { class: 'agent-messages', 'aria-live': 'polite' });
    const input = h('textarea', {
      class: 'input agent-input',
      rows: 2,
      placeholder: 'Écris tes infos en vrac, ou une modification : « ajoute Excel à mes compétences »',
      'aria-label': "Message pour l'assistant",
    });
    const send = h('button', { class: 'btn-primary', type: 'submit', 'aria-label': 'Envoyer' }, 'Envoyer');

    const intro = {
      role: 'assistant',
      text: `Salut ${session.username} ! Écris-moi tes infos (études, stages, compétences, langues) même en vrac, ou dis-moi quoi changer. Je remplis ton CV, et tu pourras tout corriger ensuite.`,
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
        write(CHAT_KEY, chat);
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

      const { status, data } = await post('/api/agent', { state: ctx.getState(), message: text, history }, session.token);
      typing.remove();
      pending = false;
      send.disabled = false;

      if (status === 401) {
        session = null;
        write(SESSION_KEY, null);
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
          write(SESSION_KEY, null);
          write(CHAT_KEY, null);
          render();
        },
      },
      'Déconnexion',
    );

    scrollDown();
    return h(
      'div',
      { class: 'agent-inner' },
      header(session.username, logout),
      list,
      h('form', { class: 'agent-compose', onSubmit: submit }, suggestions, h('div', { class: 'agent-compose-row' }, input, send)),
    );
  }

  render();
  return { el: root, focus: () => root.querySelector('textarea, input')?.focus() };
}
