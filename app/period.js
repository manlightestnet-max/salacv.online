// Période d'une formation ou d'une expérience, choisie sans clavier : on touche
// l'année (et le mois si on veut) de début, puis celle de fin, ou « En cours ».
// Le résultat reste un texte du DSL : « 2023 — 2026 », « Juin — Sept. 2025 »,
// « 2024 — aujourd'hui ».
import { h, indexField, clearInputError } from './dom.js';
import { openDialog } from './dialog.js';

export const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const MONTH_WORDS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const NOW = 'now';

const fmt = (d) => (d.m == null ? String(d.y) : `${MONTHS[d.m]} ${d.y}`);

// { start: {y, m?}, end: {y, m?} | 'now' | null } → texte du CV.
export function formatPeriod({ start, end }) {
  if (!start) return '';
  if (end === NOW) return `${fmt(start)} — aujourd'hui`;
  if (!end || (end.y === start.y && end.m === start.m)) return fmt(start);
  // Même année avec mois : « Juin — Sept. 2025 », comme sur les CV de référence.
  if (end.y === start.y && start.m != null && end.m != null) return `${MONTHS[start.m]} — ${fmt(end)}`;
  return `${fmt(start)} — ${fmt(end)}`;
}

// Texte existant → sélection (au mieux), pour rouvrir le sélecteur sur la bonne date.
export function parsePeriod(text) {
  const t = String(text ?? '').toLowerCase();
  const [left, right] = t.split(/\s[—–-]\s|\sau\s/);
  const date = (part, fallbackYear) => {
    if (!part) return null;
    const y = Number(part.match(/\b(19|20)\d{2}\b/)?.[0] ?? fallbackYear);
    if (!y) return null;
    const m = MONTH_WORDS.findIndex((w) => part.includes(w));
    return { y, ...(m >= 0 ? { m } : {}) };
  };
  if (right && /aujourd|présent|en cours|actuel/.test(right)) return { start: date(left), end: NOW };
  const end = date(right);
  return { start: date(left, end?.y), end };
}

// Champ « Période » : un bouton qui affiche la valeur et ouvre le sélecteur.
export function periodField(obj, key, onInput, { label = 'Période' } = {}) {
  const value = h('span', { class: 'period-value' });
  const button = h('button', { class: 'input period-button', type: 'button', 'aria-haspopup': 'dialog' }, value, h('span', { class: 'period-icon', 'aria-hidden': 'true' }, '▾'));
  const sync = () => {
    value.textContent = obj[key] || 'Choisir les dates';
    value.classList.toggle('placeholder', !obj[key]);
  };
  button.addEventListener('click', () =>
    openPeriodPicker(obj[key], (text) => {
      obj[key] = text;
      sync();
      onInput();
    }),
  );
  sync();
  const root = h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), button);
  indexField(obj, key, root, button);
  button.addEventListener('click', () => clearInputError(root));
  return root;
}

export function openPeriodPicker(current, onPick) {
  // Date maximale = aujourd'hui, recalculée à chaque ouverture (rien n'est figé sur une année).
  const today = new Date();
  const thisYear = today.getFullYear();
  const thisMonth = today.getMonth();
  const years = [];
  for (let y = thisYear; y >= 1980; y--) years.push(y);
  const inFuture = (y, m) => y > thisYear || (y === thisYear && m != null && m > thisMonth);

  const sel = parsePeriod(current);
  // Toujours dans l'ordre : début, puis fin (la pastille « Fin » permet de ne changer que la fin).
  let slot = 'start';
  let withMonth = sel.start?.m != null;
  let pendingYear = null; // année touchée, en attente du mois

  const startPill = h('button', { type: 'button', class: 'slot-pill' });
  const endPill = h('button', { type: 'button', class: 'slot-pill' });
  const monthToggle = h('button', { type: 'button', class: 'pill-option' }, 'Préciser le mois');
  const quick = h('div', { class: 'period-quick' });
  const grid = h('div', { class: 'period-grid', role: 'listbox' });
  const preview = h('p', { class: 'period-preview', 'aria-live': 'polite' });
  const hint = h('p', { class: 'hint' });

  startPill.addEventListener('click', () => go('start'));
  endPill.addEventListener('click', () => sel.start && go('end'));
  monthToggle.addEventListener('click', () => {
    withMonth = !withMonth;
    pendingYear = null;
    render();
  });

  function go(next) {
    slot = next;
    pendingYear = null;
    render();
  }

  function choose(date) {
    if (slot === 'start') {
      sel.start = date;
      // Une fin antérieure au nouveau début n'a plus de sens.
      if (sel.end && sel.end !== NOW && (sel.end.y < date.y || (sel.end.y === date.y && (sel.end.m ?? 99) < (date.m ?? 0)))) sel.end = null;
      go('end');
    } else {
      sel.end = date;
      finish();
    }
  }

  function finish() {
    dialog.close();
    onPick(formatPeriod(sel));
  }

  function render() {
    const label = (d, empty) => (d === NOW ? "Aujourd'hui" : d ? fmt(d) : empty);
    startPill.replaceChildren(h('small', {}, 'Début'), h('strong', {}, label(sel.start, '—')));
    endPill.replaceChildren(h('small', {}, 'Fin'), h('strong', {}, label(sel.end, '—')));
    startPill.setAttribute('aria-pressed', String(slot === 'start'));
    endPill.setAttribute('aria-pressed', String(slot === 'end'));
    endPill.disabled = !sel.start;
    monthToggle.setAttribute('aria-pressed', String(withMonth));
    preview.textContent = sel.start ? `Sur le CV : ${formatPeriod(sel)}` : 'Touche l’année de début.';
    hint.textContent = `Dates jusqu’à ${MONTHS[thisMonth].toLowerCase()} ${thisYear}. Pour un diplôme en cours, choisis « En cours ».`;

    quick.replaceChildren(
      ...(slot === 'end'
        ? [
            h('button', { type: 'button', class: 'pill-option', onClick: () => choose(NOW) }, 'En cours'),
            h('button', { type: 'button', class: 'pill-option', onClick: () => ((sel.end = null), finish()) }, 'Pas de date de fin'),
          ]
        : []),
      monthToggle,
    );

    if (pendingYear != null) {
      // Deuxième temps : le mois de l'année touchée.
      grid.className = 'period-grid months';
      grid.replaceChildren(
        h('button', { type: 'button', class: 'period-back', onClick: () => ((pendingYear = null), render()) }, `‹ ${pendingYear}`),
        ...MONTHS.map((m, i) => {
          const tooEarly = slot === 'end' && sel.start && (pendingYear < sel.start.y || (pendingYear === sel.start.y && i < (sel.start.m ?? 0)));
          return h('button', { type: 'button', class: 'period-cell', disabled: tooEarly || inFuture(pendingYear, i), title: inFuture(pendingYear, i) ? 'Ce mois n’est pas encore passé' : null, onClick: () => choose({ y: pendingYear, m: i }) }, m);
        }),
      );
      return;
    }

    grid.className = 'period-grid years';
    const current = slot === 'start' ? sel.start : sel.end !== NOW ? sel.end : null;
    grid.replaceChildren(
      ...years.map((y) => {
        const tooEarly = slot === 'end' && sel.start && y < sel.start.y;
        return h(
          'button',
          {
            type: 'button',
            class: 'period-cell',
            role: 'option',
            'aria-selected': String(current?.y === y),
            disabled: tooEarly,
            onClick: () => {
              if (withMonth) {
                pendingYear = y;
                render();
              } else choose({ y });
            },
          },
          String(y),
        );
      }),
    );
    // L'année choisie (ou l'année en cours) visible sans chercher.
    const anchor = grid.children[Math.max(0, years.indexOf(current?.y ?? thisYear))];
    requestAnimationFrame(() => anchor?.scrollIntoView({ block: 'center' }));
  }

  const dialog = openDialog({
    title: 'Période',
    className: 'period-dialog',
    content: [h('div', { class: 'slot-pills' }, startPill, endPill), quick, grid, preview, hint],
    footer: [
      h('button', { type: 'button', class: 'btn-text', onClick: () => (dialog.close(), onPick('')) }, 'Effacer'),
      h('button', { type: 'button', class: 'btn-ghost', 'data-autofocus': true, onClick: () => dialog.close() }, 'Annuler'),
    ],
  });
  render();
}
