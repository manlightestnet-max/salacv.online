// Connexion : Google (web et PC) et, sur PC seulement, une clé KEYGEN.
//   SCVO-… clé hors ligne : vérifiée sur ce PC, sans Internet (accès à l'app)
//   SCVN-… clé en ligne  : vérifiée par le serveur, ouvre une session (assistant, crédits)
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { getSession, initSession } from './session.js';

const desktop = () => (window.desktop?.isDesktop ? window.desktop : null);

// Compat : l'identité vient de session.js (serveur), plus du navigateur.
export const readSession = getSession;

const dateFr = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const GOOGLE_G = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>';

// onDone({ kind }) : appelé quand une connexion aboutit sans recharger la page (clé).
export function loginPanel({ onDone, intro } = {}) {
  const pc = desktop();
  const status = h('p', { class: 'login-status', role: 'status', hidden: true });
  const error = h('p', { class: 'agent-error', role: 'alert', hidden: true });
  const say = (text, isError = true) => {
    const el = isError ? error : status;
    (isError ? status : error).hidden = true;
    el.textContent = text;
    el.hidden = !text;
  };

  // --- Google -----------------------------------------------------------------
  const google = h('button', { type: 'button', class: 'login-google' });
  google.innerHTML = `${GOOGLE_G}<span>Continuer avec Google</span>`;
  google.addEventListener('click', async () => {
    if (!navigator.onLine) return say('Pas de connexion Internet. La connexion Google en a besoin.' + (pc ? ' Une clé hors ligne marche sans Internet.' : ''));
    if (!pc) {
      location.href = `/auth/?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    google.disabled = true;
    try {
      await pc.googleStart();
      say('Termine la connexion dans ton navigateur : l’app s’ouvrira toute seule ensuite.', false);
      waitForGoogle();
    } catch {
      say('Impossible d’ouvrir le navigateur. Réessaie.');
    }
    setTimeout(() => (google.disabled = false), 4000);
  });

  // PC : la connexion se termine dans le navigateur du système. L'app est prévenue par le processus principal
  // (jeton rangé dans le coffre) ; à défaut, on redemande l'identité au serveur quand l'app reprend la main.
  let signedIn = false;
  async function checkGoogle() {
    if (signedIn || !(await initSession())) return;
    signedIn = true;
    stopWaiting();
    say('Connecté.', false);
    onDone?.({ kind: 'google' });
  }
  let stopWaiting = () => {};
  function waitForGoogle() {
    stopWaiting();
    const timer = setInterval(checkGoogle, 4000);
    const until = setTimeout(() => stopWaiting(), 10 * 60 * 1000); // le lien de connexion expire après 10 min
    window.addEventListener('focus', checkGoogle);
    stopWaiting = () => {
      clearInterval(timer);
      clearTimeout(until);
      window.removeEventListener('focus', checkGoogle);
    };
  }
  pc?.onSignedIn?.(checkGoogle);

  const parts = [intro && h('p', { class: 'login-intro' }, intro), google];

  // --- Clé (PC uniquement) ------------------------------------------------------
  if (pc) {
    const license = h('p', { class: 'login-license', hidden: true });
    pc.license.status().then((st) => {
      if (st?.state === 'active') {
        license.textContent = `Clé hors ligne active : encore ${st.daysLeft} jour${st.daysLeft > 1 ? 's' : ''} (jusqu’au ${dateFr(st.expiresAt)}).`;
        license.hidden = false;
      }
    }).catch(() => {});

    const input = h('input', { class: 'input login-key', type: 'text', id: 'login-key', placeholder: 'SCVO-… ou SCVN-…', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'login-key-hint' });
    const activate = h('button', { type: 'button', class: 'btn-ghost' }, 'Activer la clé');

    async function activateKey() {
      const key = input.value.trim().toUpperCase().replace(/\s+/g, '');
      if (!key) return say('Colle ta clé d’accès.');
      activate.disabled = true;
      try {
        if (key.startsWith('SCVO')) {
          const r = await pc.license.activate(key);
          if (!r.ok) return say(r.error || 'Clé refusée.');
          say(`Clé activée : encore ${r.daysLeft} jour${r.daysLeft > 1 ? 's' : ''} (jusqu’au ${dateFr(r.expiresAt)}). Elle marche sans Internet.`, false);
          onDone?.({ kind: 'offline', ...r });
        } else if (key.startsWith('SCVN')) {
          if (!navigator.onLine) return say('Pas de connexion Internet. Une clé en ligne a besoin d’Internet pour s’activer.');
          const device = await pc.deviceId();
          const res = await fetch('/api/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, device }) }).catch(() => null);
          if (!res) return say('Le serveur ne répond pas. Vérifie ta connexion puis réessaie.');
          const data = await res.json().catch(() => ({ ok: false }));
          if (!data.ok) return say(data.error || (res.status >= 500 ? 'Le serveur ne répond pas. Réessaie dans un instant.' : 'Clé refusée.'));
          await initSession(); // le serveur a posé le cookie : on relit l'identité
          say(`Clé activée jusqu’au ${dateFr(data.expiresAt)}.`, false);
          onDone?.({ kind: 'key', expiresAt: data.expiresAt });
        } else {
          say('Clé non reconnue : elle commence par SCVO (hors ligne) ou SCVN (en ligne).');
        }
      } finally {
        activate.disabled = false;
      }
    }
    activate.addEventListener('click', activateKey);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), activateKey()));

    parts.push(
      h('div', { class: 'login-or', 'aria-hidden': 'true' }, h('span', {}, 'ou')),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'login-key' }, 'J’ai une clé d’accès'),
        license,
        h('div', { class: 'items-entry' }, input, activate),
        h('p', { class: 'hint', id: 'login-key-hint' }, 'SCVO : clé hors ligne, marche sans Internet. SCVN : clé en ligne, ouvre aussi l’assistant.'),
      ),
    );
  }

  parts.push(status, error);
  return h('div', { class: 'login-panel' }, parts);
}

export function openLogin(opts = {}) {
  const dialog = openDialog({
    title: 'Connexion',
    className: 'login-dialog',
    content: loginPanel({ ...opts, onDone: (r) => (opts.onDone?.(r), setTimeout(() => dialog.close(), 900)) }),
  });
  return dialog;
}
