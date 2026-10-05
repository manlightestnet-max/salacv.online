// Versions du CV par langue, en onglets comme les feuilles d'Excel. La version
// d'origine est project.state ; les autres sont dans project.variants[lang]. Le modèle
// et la photo sont communs à toutes les versions ; le contenu est propre à chacune.
import { LANGS, langName } from '../src/i18n/index.js';
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { normalizeState } from './state.js';
import { getSession } from './session.js';

const session = getSession; // l'identité vient du serveur (cookie httpOnly)

// La version dans `lang`, avec le modèle et la photo de `from`.
function withShared(next, from) {
  const s = normalizeState(next);
  s.template = from.template;
  s.profile.photo = from.profile.photo;
  return s;
}

async function requestTranslation(state, to) {
  const { photo, ...profile } = state.profile; // la photo ne part jamais
  let res;
  try {
    res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { ...state, profile, template: undefined }, to }),
    });
  } catch {
    return { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' };
  }
  return res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
}

const online = () => navigator.onLine !== false;

// Message sérieux (et non un simple toast) : ce qui s'est passé, ce qui reste possible, ce qu'on peut faire.
function notice({ title, text, hint, actions = [] }) {
  const d = openDialog({
    title,
    className: 'notice-dialog',
    content: [h('p', { class: 'notice-text' }, text), hint && h('p', { class: 'lang-note' }, hint)],
    footer: [
      h('button', { type: 'button', class: actions.length ? 'btn-ghost' : 'btn-primary', 'data-autofocus': !actions.length || null, onClick: () => d.close() }, actions.length ? 'Fermer' : 'OK'),
      ...actions.map((a, i) => h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': i === 0 || null, onClick: () => (d.close(), a.run()) }, a.label)),
    ],
  });
  return d;
}

// ctx : { project, getState(), getLang(), switchTo(lang, state), save(), askLogin(), toast(text) }
export function createLangBar(ctx) {
  const tabs = document.getElementById('lang-tabs');
  const busy = new Set();
  const main = () => ctx.project.state.lang;
  const versions = () => [main(), ...Object.keys(ctx.project.variants ?? {}).filter((l) => l !== main())];
  // Empreinte du contenu de l'original (sans modèle, langue ni photo) : si l'original a
  // changé depuis la traduction, on recommande de la rafraîchir.
  const sig = (st) => {
    const { template, lang, profile, ...rest } = st ?? {};
    return JSON.stringify([rest, { ...profile, photo: '' }]);
  };
  // doc : le CV du projet (par défaut le CV actif) ; l'original vivant est l'état en cours d'édition.
  const stale = (lang, doc = ctx.project) => {
    const t = doc.translatedFrom?.[lang];
    const src = doc === ctx.project && main() === ctx.getLang() ? ctx.getState() : doc.state;
    return Boolean(t) && t !== sig(src);
  };

  // Garde commune de la traduction automatique : un compte, et Internet. Retourne vrai si bloqué.
  function blocked(retry) {
    if (!session()) {
      notice({
        title: 'Connexion requise',
        text: 'La traduction automatique passe par l’assistant IA, qui demande un compte.',
        hint: 'Pour traduire toi-même, duplique le CV depuis la liste du projet (icône Dupliquer) et modifie la copie.',
        actions: [{ label: 'Me connecter', run: () => ctx.askLogin() }],
      });
      return true;
    }
    if (!online()) {
      notice({
        title: 'Pas de connexion Internet',
        text: 'La traduction automatique a besoin d’Internet. Rien n’a été modifié : ton CV et ses versions restent disponibles et modifiables hors connexion.',
        hint: 'Reconnecte-toi puis réessaie.',
        actions: retry ? [{ label: 'Réessayer', run: retry }] : [],
      });
      return true;
    }
    return false;
  }

  function render() {
    tabs.replaceChildren(
      ...versions().map((lang) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `lang-tab${busy.has(lang) ? ' busy' : ''}`,
            'aria-selected': String(lang === ctx.getLang()),
            title: langName(lang),
            onClick: () => (lang === ctx.getLang() ? manage(lang) : open(lang)),
          },
          h('span', { class: 'lang-code' }, lang),
          h('span', { class: 'lang-name' }, langName(lang)),
        ),
      ),
      // Versions traduites en retard sur l'original : un bouton pour les rafraîchir.
      ...versions()
        .filter((l) => l !== main() && !busy.has(l) && stale(l))
        .map((l) =>
          h(
            'button',
            { type: 'button', class: 'lang-refresh', title: `L’original a changé : retraduire la version ${langName(l)}`, onClick: () => refresh(l) },
            `↻ ${l.toUpperCase()}`,
          ),
        ),
    );
  }

  function refresh(lang) {
    if (blocked(() => refresh(lang))) return;
    const from = main() === ctx.getLang() ? ctx.getState() : ctx.project.state;
    translateInto(lang, from);
  }

  function open(lang) {
    if (busy.has(lang)) return ctx.toast(`Traduction en ${langName(lang)} en cours…`);
    const source = lang === main() ? ctx.project.state : ctx.project.variants[lang];
    ctx.switchTo(lang, withShared(source, ctx.getState()));
    render();
  }

  async function translateInto(lang, from) {
    if (blocked(() => translateInto(lang, from))) return;
    busy.add(lang);
    render();
    ctx.changed?.();
    const r = await requestTranslation(from, lang);
    busy.delete(lang);
    if (!r.ok) {
      render();
      ctx.changed?.();
      if (r.error?.includes('Connecte-toi')) return blocked();
      return notice({
        title: 'Traduction impossible',
        text: r.error ?? 'La traduction a échoué.',
        hint: 'Rien n’a été modifié. Tu peux réessayer, ou dupliquer le CV depuis la liste du projet et le traduire toi-même.',
        actions: [{ label: 'Réessayer', run: () => translateInto(lang, from) }],
      });
    }
    ctx.project.variants = { ...ctx.project.variants, [lang]: withShared(r.state, ctx.getState()) };
    ctx.project.translatedFrom = { ...ctx.project.translatedFrom, [lang]: sig(from) };
    ctx.save();
    open(lang);
    ctx.toast(`Version ${langName(lang)} prête : relis-la, touche le CV pour corriger.`);
  }

  // Ajouter une langue : traduction automatique (assistant connecté) ou copie à traduire soi-même.
  function add() {
    const taken = new Set(versions());
    let pick = LANGS.find((l) => !taken.has(l));
    if (!pick) return ctx.toast('Toutes les langues disponibles sont déjà là.');
    const options = LANGS.map((l) =>
      h(
        'button',
        { type: 'button', class: 'lang-option', disabled: taken.has(l), 'aria-pressed': String(l === pick), onClick: () => select(l) },
        langName(l),
        h('small', {}, taken.has(l) ? `${l} · déjà là` : l),
      ),
    );
    function select(l) {
      pick = l;
      options.forEach((b, i) => b.setAttribute('aria-pressed', String(LANGS[i] === l)));
    }
    const logged = Boolean(session());
    const from = ctx.getState();
    const offline = !online();
    const dialog = openDialog({
      title: 'Ajouter une langue',
      className: 'lang-dialog',
      content: [
        h('div', { class: 'lang-options', role: 'group', 'aria-label': 'Langue' }, options),
        h(
          'p',
          { class: 'lang-note' },
          `À partir de la version ${langName(ctx.getLang())}. Les titres des sections et les niveaux de langue changent tout seuls ; ton nom et tes contacts ne bougent pas.`,
        ),
        !logged && h('p', { class: 'lang-note' }, 'La traduction automatique passe par l’assistant : connecte-toi d’abord. Pour traduire toi-même, duplique le CV depuis la liste du projet.'),
        logged && offline && h('p', { class: 'lang-note' }, 'Pas de connexion Internet : la traduction automatique reviendra quand tu seras en ligne.'),
      ],
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler'),
        logged
          ? h('button', { type: 'button', class: 'btn-primary', disabled: offline, title: offline ? 'Hors connexion' : null, 'data-autofocus': true, onClick: () => (dialog.close(), translateInto(pick, from)) }, 'Traduire automatiquement')
          : h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => (dialog.close(), ctx.askLogin()) }, 'Me connecter'),
      ],
    });
  }

  // Onglet actif touché : retraduire depuis l'original, ou supprimer cette version.
  function manage(lang) {
    if (lang === main()) {
      // L'original : on propose les versions générées (EN, PT…) et leur état.
      const others = versions().filter((l) => l !== main());
      const d = openDialog({
        title: `Version ${langName(lang)} · originale`,
        content: [
          h('p', { class: 'lang-note' }, others.length ? 'Les autres versions sont faites à partir de celle-ci.' : 'Crée une version en anglais, portugais… à partir de celle-ci.'),
          others.length &&
            h(
              'div',
              { class: 'lang-options' },
              others.map((l) =>
                h(
                  'button',
                  { type: 'button', class: 'lang-option', onClick: () => (d.close(), stale(l) ? refresh(l) : open(l)) },
                  langName(l),
                  h('small', {}, stale(l) ? '↻ à retraduire (recommandé)' : ctx.project.translatedFrom?.[l] ? 'à jour' : 'copie manuelle'),
                ),
              ),
            ),
        ],
        footer: [h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => (d.close(), add()) }, '+ Ajouter une langue')],
      });
      return;
    }
    const logged = Boolean(session());
    const dialog = openDialog({
      title: `Version ${langName(lang)}`,
      content: h('p', { class: 'lang-note' }, `Retraduire remplace cette version par une nouvelle traduction de la version ${langName(main())}.`),
      footer: [
        h(
          'button',
          {
            type: 'button',
            class: 'btn-text danger-text',
            onClick: () => {
              dialog.close();
              const { [lang]: _, ...rest } = ctx.project.variants;
              ctx.project.variants = rest;
              open(main());
              ctx.save();
            },
          },
          'Supprimer',
        ),
        h(
          'button',
          { type: 'button', class: 'btn-primary', disabled: !logged, onClick: () => (dialog.close(), open(main()), translateInto(lang, ctx.project.state)) },
          'Retraduire',
        ),
      ],
    });
  }

  document.getElementById('lang-add').addEventListener('click', add);
  render();
  return { render, open, versions, refresh, add, stale, busy: (lang) => busy.has(lang), main, online };
}
