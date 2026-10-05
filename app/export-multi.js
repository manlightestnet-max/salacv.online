// Mode Pro : exporter plusieurs CV du projet d'un coup. Une ligne par CV (et par langue) : on coche PDF et/ou Word
// pour chacun. Le serveur décide des droits CV par CV (crédits, filigrane, Word verrouillé) : on l'interroge d'abord
// (sans rien générer ni débiter) pour annoncer ce qui va se passer, puis on génère un par un.
import { h, icon } from './dom.js';
import { openDialog } from './dialog.js';
import { toResume } from './state.js';
import { MIME, callRender, fileRow, getDesktop, save, shareForTrial, slug, toBlob } from './export.js';

// items : [{ key, label, lang, state }]
export function openMultiExport({ items }) {
  const desktop = getDesktop();
  const body = h('div', { class: 'export multi' });
  const foot = h('div', { class: 'export-foot' });
  const dialog = openDialog({ title: 'Exporter plusieurs CV', className: 'export-dialog multi-dialog', content: body, footer: foot });
  const close = h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler');
  const here = `/auth/?next=${encodeURIComponent(location.pathname + location.search)}`;
  const rows = items.map((it) => ({ ...it, named: Boolean(toResume(it.state).profile.name), pdf: true, docx: false, info: null }));

  async function load() {
    body.replaceChildren(h('p', { class: 'hint' }, 'Vérification de tes droits pour chaque CV…'));
    foot.replaceChildren(close);
    await Promise.all(rows.map(async (r) => (r.info = r.named ? (await callRender({ state: r.state, dryRun: true })).data : null)));
    const failed = rows.find((r) => r.named && !r.info?.ok);
    if (failed) {
      body.replaceChildren(h('p', { class: 'export-error' }, failed.info?.error || 'Impossible de vérifier tes droits.'));
      foot.replaceChildren(close, h('button', { type: 'button', class: 'btn-primary', onClick: load }, 'Réessayer'));
      return;
    }
    paint();
  }

  // Combien de crédits, et combien de CV sortiront avec filigrane (le solde s'épuise dans l'ordre de la liste).
  function plan() {
    const first = rows.find((r) => r.info?.ok);
    let left = first?.info.balance ?? 0;
    let cost = 0;
    let marked = 0;
    for (const r of rows) {
      if (!r.named || !r.pdf || !r.info?.ok) continue;
      if (r.info.cost === 0 && r.info.entitlement === 'clean') continue; // déjà payée
      if (r.info.loggedIn && left >= 1) {
        left -= 1;
        cost += 1;
        r.willBeClean = true;
      } else {
        marked += 1;
        r.willBeClean = false;
      }
    }
    return { cost, marked, left, loggedIn: Boolean(first?.info.loggedIn) };
  }

  function paint() {
    const summary = h('div', { class: 'cost' });
    const list = h(
      'ul',
      { class: 'multi-list' },
      rows.map((r) => {
        const wordOk = r.info?.wordAllowed;
        const pdfBox = h('input', { type: 'checkbox', checked: r.pdf || null, disabled: !r.named || null, 'aria-label': `PDF — ${r.label} ${r.lang}` });
        const docxBox = h('input', { type: 'checkbox', checked: r.docx || null, disabled: !r.named || !wordOk || null, 'aria-label': `Word — ${r.label} ${r.lang}` });
        pdfBox.addEventListener('change', () => ((r.pdf = pdfBox.checked), refresh()));
        docxBox.addEventListener('change', () => ((r.docx = docxBox.checked), refresh()));
        return h(
          'li',
          { class: `multi-row${r.named ? '' : ' off'}` },
          h('div', { class: 'multi-name' }, h('strong', {}, r.label), h('span', { class: 'multi-lang' }, String(r.lang).toUpperCase()), !r.named && h('small', {}, 'Nom manquant : à compléter avant d’exporter')),
          h('label', { class: 'multi-opt' }, pdfBox, h('span', {}, 'PDF')),
          h('label', { class: `multi-opt${wordOk ? '' : ' locked'}`, title: wordOk ? '' : 'Word : réservé aux CV débloqués avec un crédit' }, docxBox, h('span', {}, 'Word'), !wordOk && icon('lock', 12)),
        );
      }),
    );
    function refresh() {
      const p = plan();
      const picked = rows.filter((r) => r.named && (r.pdf || r.docx)).length;
      summary.className = `cost${p.marked ? ' empty' : ''}`;
      summary.replaceChildren(
        h(
          'span',
          {},
          picked ? h('strong', {}, `${picked} CV sélectionné${picked > 1 ? 's' : ''}`) : 'Rien de sélectionné',
          p.cost ? ` · ${p.cost} crédit${p.cost > 1 ? 's' : ''}` : '',
          p.marked ? (p.loggedIn ? ` · ${p.marked} sans assez de crédits : PDF avec filigrane` : ` · ${p.marked} avec filigrane (connecte-toi pour les retirer)`) : '',
        ),
        p.marked ? (p.loggedIn ? h('a', { class: 'cost-link', href: '/dashboard/#credits' }, 'Mes crédits') : h('a', { class: 'cost-link', href: here }, 'Se connecter')) : h('a', { class: 'cost-link', href: '/dashboard/#credits' }, 'Mes crédits'),
      );
      go.disabled = !picked;
    }
    const go = h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: generate }, 'Préparer');
    body.replaceChildren(h('p', { class: 'hint' }, 'Choisis, pour chaque CV du projet, les formats à préparer. Le serveur applique les droits CV par CV.'), list, summary);
    foot.replaceChildren(close, go);
    refresh();
  }

  // --- Génération, un CV après l'autre --------------------------------------------------------------
  async function generate() {
    const todo = rows.filter((r) => r.named && (r.pdf || r.docx));
    const status = new Map();
    const list = h('ul', { class: 'multi-list' }, todo.map((r) => h('li', { class: 'multi-row', 'data-key': r.key }, h('div', { class: 'multi-name' }, h('strong', {}, r.label), h('span', { class: 'multi-lang' }, String(r.lang).toUpperCase())), h('span', { class: 'multi-status' }, 'En attente'))));
    body.replaceChildren(h('p', { class: 'hint', 'aria-live': 'polite' }, 'Préparation en cours : garde cette fenêtre ouverte.'), list);
    foot.replaceChildren(h('p', { class: 'hint' }, 'Chaque CV est généré par le serveur.'));
    const results = [];
    for (const r of todo) {
      const li = list.querySelector(`[data-key="${CSS.escape(r.key)}"] .multi-status`);
      li.textContent = 'Génération…';
      const formats = [...(r.pdf ? ['pdf'] : []), ...(r.docx && r.info?.wordAllowed ? ['docx'] : [])];
      const { data } = await callRender({ state: r.state, formats: formats.length ? formats : ['pdf'] });
      if (!data.ok) {
        li.textContent = data.error || 'Échec';
        li.classList.add('bad');
        continue;
      }
      shareForTrial(toResume(r.state));
      li.textContent = data.files.pdf?.watermarked ? 'Prêt (avec filigrane)' : 'Prêt';
      results.push({ r, data });
    }
    done(results);
  }

  function done(results) {
    const downloads = [];
    const cards = results.map(({ r, data }) => {
      const base = `CV-${slug(toResume(r.state).profile.name) || 'CV'}-${slug(r.label)}-${r.lang}`;
      const buttons = [];
      if (data.files.pdf) {
        const blob = toBlob(data.files.pdf.base64, MIME.pdf);
        const wm = data.files.pdf.watermarked;
        downloads.push([blob, `${base}.pdf`]);
        buttons.push(desktop ? fileRow(blob, `${base}.pdf`, wm ? 'PDF (avec filigrane)' : 'PDF', false) : h('button', { type: 'button', class: 'btn-ghost', onClick: () => save(blob, `${base}.pdf`) }, `PDF${wm ? ' (avec filigrane)' : ''}`));
      }
      if (data.files.docx) {
        const blob = toBlob(data.files.docx.base64, MIME.docx);
        downloads.push([blob, `${base}.docx`]);
        buttons.push(desktop ? fileRow(blob, `${base}.docx`, 'Word', false) : h('button', { type: 'button', class: 'btn-ghost', onClick: () => save(blob, `${base}.docx`) }, 'Word'));
      }
      return h('li', { class: 'multi-row done' }, h('div', { class: 'multi-name' }, h('strong', {}, r.label), h('span', { class: 'multi-lang' }, String(r.lang).toUpperCase()), data.blocked?.docx && h('small', {}, `Word : ${data.blocked.docx}`)), h('div', { class: 'multi-files' }, buttons));
    });
    body.replaceChildren(h('div', { class: 'ready' }, h('span', { class: 'ready-icon', 'aria-hidden': 'true' }), h('strong', {}, results.length ? `${results.length} CV prêt${results.length > 1 ? 's' : ''}` : 'Aucun CV généré'), h('p', {}, results.length ? 'Télécharge-les un par un, ou tout d’un coup.' : 'Réessaie dans un instant.')), h('ul', { class: 'multi-list' }, cards));
    foot.replaceChildren(
      h('button', { type: 'button', class: 'btn-text', onClick: () => dialog.close() }, 'Fermer'),
      !desktop && downloads.length > 1 && h('button', { type: 'button', class: 'btn-primary', onClick: async () => { for (const [blob, name] of downloads) { save(blob, name); await new Promise((r) => setTimeout(r, 350)); } } }, `Tout télécharger (${downloads.length})`),
    );
  }

  load();
}
