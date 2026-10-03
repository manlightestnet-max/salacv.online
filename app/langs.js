// Versions du CV par langue, en onglets comme les feuilles d'Excel. La version
// d'origine est project.state ; les autres sont dans project.variants[lang]. Le modèle
// et la photo sont communs à toutes les versions ; le contenu est propre à chacune.
import { LANGS, langName } from '../src/i18n/index.js';
import { h } from './dom.js';
import { openDialog } from './dialog.js';
import { normalizeState } from './state.js';

const SESSION_KEY = 'salacv:session';

function session() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

// La version dans `lang`, avec le modèle et la photo de `from`.
function withShared(next, from) {
  const s = normalizeState(next);
  s.template = from.template;
  s.profile.photo = from.profile.photo;
  return s;
}

async function requestTranslation(state, to) {
  const token = session()?.token;
  const { photo, ...profile } = state.profile; // la photo ne part jamais
  let res;
  try {
    res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ state: { ...state, profile, template: undefined }, to }),
    });
  } catch {
    return { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' };
  }
  return res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
}

// ctx : { project, getState(), getLang(), switchTo(lang, state), save(), askLogin(), toast(text) }
export function createLangBar(ctx) {
  const tabs = document.getElementById('lang-tabs');
  const busy = new Set();
  const main = () => ctx.project.state.lang;
  const versions = () => [main(), ...Object.keys(ctx.project.variants ?? {}).filter((l) => l !== main())];

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
    );
  }

  function open(lang) {
    if (busy.has(lang)) return ctx.toast(`Traduction en ${langName(lang)} en cours…`);
    const source = lang === main() ? ctx.project.state : ctx.project.variants[lang];
    ctx.switchTo(lang, withShared(source, ctx.getState()));
    render();
  }

  async function translateInto(lang, from) {
    busy.add(lang);
    render();
    const r = await requestTranslation(from, lang);
    busy.delete(lang);
    if (!r.ok) {
      render();
      if (r.error?.includes('Connecte-toi')) ctx.askLogin();
      return ctx.toast(r.error ?? 'La traduction a échoué.');
    }
    ctx.project.variants = { ...ctx.project.variants, [lang]: withShared(r.state, ctx.getState()) };
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
    const logged = Boolean(session()?.token);
    const from = ctx.getState();
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
        !logged && h('p', { class: 'lang-note' }, 'La traduction automatique passe par l’assistant : connecte-toi d’abord, ou copie le CV et traduis-le toi-même.'),
      ],
      footer: [
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => (dialog.close(), copy(pick, from)) }, 'Copier sans traduire'),
        logged
          ? h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => (dialog.close(), translateInto(pick, from)) }, 'Traduire automatiquement')
          : h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => (dialog.close(), ctx.askLogin()) }, 'Me connecter'),
      ],
    });
  }

  function copy(lang, from) {
    ctx.project.variants = { ...ctx.project.variants, [lang]: { ...structuredClone(from), lang } };
    ctx.save();
    open(lang);
    ctx.toast(`Version ${langName(lang)} créée : les titres sont traduits, à toi le contenu.`);
  }

  // Onglet actif touché : retraduire depuis l'original, ou supprimer cette version.
  function manage(lang) {
    if (lang === main()) return;
    const logged = Boolean(session()?.token);
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
  return { render, open, versions };
}
