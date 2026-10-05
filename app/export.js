// « Préparer mon CV » : jamais de téléchargement direct. L'étudiant lance la
// préparation, suit sa progression étape par étape, puis télécharge lui-même son PDF
// (et son Word s'il le veut). Ensuite : une note en étoiles, et l'invitation des amis.
import { layoutResume } from '../src/index.js';
import { h, icon } from './dom.js';
import { openDialog } from './dialog.js';
import { toResume } from './state.js';
import { PDF_COST, fingerprint, inviteLink, rating, saveRating, wallet } from './lib/store.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Version desktop (Electron) : une fenêtre « Enregistrer sous », puis Ouvrir / Parcourir.
const getDesktop = () => (window.desktop?.isDesktop ? window.desktop : null);
const dirOf = (file) => file.replace(/[\\/][^\\/]*$/, '');
const baseOf = (file) => file.split(/[\\/]/).pop();

function untilSunday(date) {
  const days = Math.ceil((date - Date.now()) / 86400000);
  return days <= 1 ? 'demain' : `dans ${days} jours`;
}

export async function openExport({ state, engine, onSpent, missing = [], onReview }) {
  const desktop = getDesktop();
  const resume = toResume(state);
  const key = fingerprint(JSON.stringify(resume));
  const name = resume.profile.name || 'CV';
  let withWord = false;
  const files = {};

  const body = h('div', { class: 'export' });
  const foot = h('div', { class: 'export-foot' });
  const dialog = openDialog({ title: 'Préparer mon CV', className: 'export-dialog', content: body, footer: foot });

  // --- 1. Choix du format et coût ------------------------------------------------
  async function choose() {
    const [{ credits, nextReset }, paid] = await Promise.all([wallet.balance(), wallet.isPaid(key)]);
    const enough = paid || credits >= PDF_COST;
    const wordToggle = h(
      'button',
      { type: 'button', class: 'format-card', 'aria-pressed': String(withWord), onClick: () => wordToggle.setAttribute('aria-pressed', String((withWord = !withWord))) },
      h('span', { class: 'format-badge' }, 'DOCX'),
      h('span', { class: 'format-text' }, h('strong', {}, 'Aussi en Word'), h('small', {}, 'Une version modifiable, une colonne')),
      h('span', { class: 'format-check', 'aria-hidden': 'true' }),
    );
    // La vérification conseille sans bloquer : on rappelle ce qui manque, on laisse générer.
    const advice =
      missing.length > 0 &&
      h(
        'div',
        { class: 'export-advice' },
        h('strong', {}, `${missing.length} point${missing.length > 1 ? 's' : ''} à revoir (conseillé)`),
        h('ul', {}, missing.map((m) => h('li', {}, m.text))),
        onReview && h('button', { type: 'button', class: 'btn-text', onClick: () => (dialog.close(), onReview()) }, 'Vérifier d’abord'),
      );
    body.replaceChildren(
      advice || '',
      h(
        'div',
        { class: 'format-card static', 'aria-pressed': 'true' },
        h('span', { class: 'format-badge' }, 'PDF'),
        h('span', { class: 'format-text' }, h('strong', {}, 'PDF haute qualité'), h('small', {}, 'Vectoriel, sans filigrane, prêt à envoyer')),
        h('span', { class: 'format-check', 'aria-hidden': 'true' }),
      ),
      wordToggle,
      h(
        'div',
        { class: `cost ${enough ? '' : 'empty'}` },
        paid
          ? h('span', {}, 'Cette version est déjà préparée : ', h('strong', {}, 'gratuit'))
          : enough
            ? h('span', {}, h('strong', {}, `${PDF_COST} crédit`), ` · il t'en restera ${credits - PDF_COST}`)
            : h('span', {}, h('strong', {}, 'Plus de crédit cette semaine.'), ` Ils reviennent dimanche (${untilSunday(nextReset)}).`),
        h('a', { class: 'cost-link', href: '/dashboard/#credits' }, 'Mes crédits'),
      ),
    );
    body.append(h('p', { class: 'trial-note' }, 'Phase d’essai : les CV générés sont conservés (sans photo) et utilisés pour améliorer salacv.'));
    foot.replaceChildren(
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler'),
      h('button', { type: 'button', class: 'btn-primary', disabled: !enough, 'data-autofocus': true, onClick: prepare }, 'Préparer mon PDF'),
    );
  }

  // --- 2. Progression ------------------------------------------------------------
  async function prepare() {
    const steps = [
      ['check', 'Vérification de tes informations'],
      ['layout', 'Mise en page'],
      ['fonts', 'Intégration des polices'],
      ['pdf', 'Génération du PDF vectoriel'],
      ...(withWord ? [['word', 'Création du document Word']] : []),
      ['done', 'Finalisation'],
    ];
    const rows = steps.map(([id, label]) => h('li', { class: 'progress-step', 'data-id': id }, h('span', { class: 'progress-dot', 'aria-hidden': 'true' }), h('span', {}, label)));
    const bar = h('div', { class: 'progress-bar' }, h('span'));
    const pct = h('strong', { class: 'progress-pct' }, '0 %');
    body.replaceChildren(h('div', { class: 'progress-head' }, h('span', {}, 'Préparation en cours'), pct), bar, h('ol', { class: 'progress-steps', 'aria-live': 'polite' }, rows));
    foot.replaceChildren(h('p', { class: 'hint' }, 'Garde cette fenêtre ouverte, ça prend quelques secondes.'));

    let i = 0;
    const advance = async (work) => {
      rows[i].classList.add('active');
      const started = performance.now();
      const result = await work();
      // Chaque étape reste visible un instant : l'étudiant voit le travail avancer.
      await pause(Math.max(0, 420 - (performance.now() - started)));
      rows[i].classList.replace('active', 'done');
      i++;
      const p = Math.round((i / steps.length) * 100);
      bar.firstChild.style.width = `${p}%`;
      pct.textContent = `${p} %`;
      return result;
    };

    try {
      let layout;
      await advance(async () => {
        if (!resume.profile.name) throw new Error('Ton nom manque.');
      });
      await advance(async () => {
        layout = layoutResume(resume, engine.fonts);
        if (!layout.ok) throw new Error('La mise en page a échoué.');
      });
      const { renderPdf } = await advance(() => import('../src/render/pdf.js'));
      await advance(async () => {
        const bytes = await renderPdf(layout.doc, engine.fonts, { title: `CV — ${name}`, author: name });
        files.pdf = new Blob([bytes], { type: 'application/pdf' });
      });
      if (withWord) {
        await advance(async () => {
          const { renderDocx } = await import('../src/render/docx.js');
          files.docx = await renderDocx(layout.resume);
        });
      }
      await advance(async () => {
        // Phase d'essai : le CV (sans photo) est conservé pour améliorer salacv (annoncé plus haut).
        shareForTrial(resume);
        const spent = await wallet.spend(PDF_COST, { reason: `CV ${name}`, key });
        if (!spent.ok) throw new Error('Plus de crédit disponible.');
        onSpent?.(spent.credits);
      });
      ready();
    } catch (err) {
      rows[i]?.classList.replace('active', 'failed');
      body.append(h('p', { class: 'export-error' }, err.message || 'La préparation a échoué.', ' Aucun crédit n’a été utilisé.'));
      foot.replaceChildren(h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Fermer'), h('button', { type: 'button', class: 'btn-primary', onClick: choose }, 'Réessayer'));
    }
  }

  // --- 3. Prêt : l'étudiant télécharge lui-même ------------------------------------
  function ready() {
    const file = slug(name) || 'CV';
    body.replaceChildren(
      h('div', { class: 'ready' }, h('span', { class: 'ready-icon', 'aria-hidden': 'true' }), h('strong', {}, 'Ton CV est prêt'), h('p', {}, desktop ? 'Choisis où l’enregistrer.' : 'Télécharge-le quand tu veux.')),
      h(
        'div',
        { class: 'ready-files' },
        desktop
          ? fileRow(files.pdf, `CV-${file}.pdf`, 'PDF', true)
          : h('button', { type: 'button', class: 'btn-primary btn-lg', 'data-autofocus': true, onClick: () => save(files.pdf, `CV-${file}.pdf`) }, 'Télécharger le PDF'),
        files.docx &&
          (desktop
            ? fileRow(files.docx, `CV-${file}.docx`, 'Word', false)
            : h('button', { type: 'button', class: 'btn-ghost btn-lg', onClick: () => save(files.docx, `CV-${file}.docx`) }, 'Télécharger le Word')),
      ),
      feedback(),
    );
    foot.replaceChildren(h('button', { type: 'button', class: 'btn-text', onClick: () => dialog.close() }, 'Fermer'));
  }

  choose();
}

// Desktop : une carte par fichier, comme au choix du format. « Enregistrer… » demande où le ranger ;
// ensuite la carte dit où il est, avec Ouvrir (le fichier) et Parcourir (son dossier).
function fileRow(blob, filename, label, primary) {
  const desktop = getDesktop();
  const row = h('div', { class: 'file-row' });
  const badge = h('span', { class: 'format-badge' }, filename.endsWith('.pdf') ? 'PDF' : 'DOCX');
  const kind = filename.endsWith('.pdf') ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'Document Word', extensions: ['docx'] }];

  function ask(first) {
    const card = h(
      'button',
      { type: 'button', class: 'format-card', 'aria-pressed': String(primary), 'data-autofocus': first && primary ? true : null },
      badge,
      h('span', { class: 'format-text' }, h('strong', {}, `Enregistrer le ${label}`), h('small', {}, 'Tu choisis le dossier')),
      icon('download', 17),
    );
    const msg = h('p', { class: 'export-error', hidden: true });
    card.addEventListener('click', async () => {
      card.disabled = true;
      let r;
      try {
        r = await desktop.saveFile(filename, await blob.arrayBuffer(), kind);
      } catch {
        r = { ok: false };
      }
      card.disabled = false;
      if (r?.ok) return saved(r.path);
      if (!r?.canceled) {
        msg.textContent = 'L’enregistrement a échoué. Choisis un autre dossier.';
        msg.hidden = false;
      }
    });
    row.replaceChildren(card, msg);
  }

  function saved(path) {
    row.replaceChildren(
      h(
        'div',
        { class: 'format-card static file-done' },
        badge,
        h('span', { class: 'format-text' }, h('strong', {}, baseOf(path)), h('small', { title: path }, dirOf(path))),
        h('span', { class: 'file-check', title: 'Enregistré' }, icon('check', 14)),
      ),
      h(
        'div',
        { class: 'file-actions' },
        h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => desktop.open(path) }, 'Ouvrir'),
        h('button', { type: 'button', class: 'btn-ghost', onClick: () => desktop.reveal(path) }, 'Parcourir'),
        h('button', { type: 'button', class: 'btn-link file-again', onClick: () => ask(false) }, 'Enregistrer ailleurs'),
      ),
    );
  }

  ask(true);
  return row;
}

// Note en étoiles puis, si l'étudiant est content, l'invitation de ses amis.
function feedback() {
  const box = h('section', { class: 'feedback' });
  const previous = rating();

  function stars(value = 0) {
    const row = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Ta note' });
    for (let n = 1; n <= 5; n++) {
      row.append(
        h('button', {
          type: 'button',
          class: 'star',
          role: 'radio',
          'aria-checked': String(n === value),
          'aria-label': `${n} étoile${n > 1 ? 's' : ''}`,
          'data-on': String(n <= value),
          onClick: () => rate(n),
        }),
      );
    }
    return row;
  }

  function rate(n) {
    saveRating(n);
    if (n >= 4) return invite(n);
    const text = h('textarea', { class: 'input', rows: 3, placeholder: 'Qu’est-ce qui t’a gêné ?' });
    box.replaceChildren(
      h('strong', {}, 'Merci. Qu’est-ce qu’on peut améliorer ?'),
      stars(n),
      text,
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => (saveRating(n, text.value.trim()), invite(n)) }, 'Envoyer'),
    );
    text.focus();
  }

  function invite(n) {
    const link = inviteLink();
    const message = `Je viens de faire mon CV sur salacv en quelques minutes. Fais le tien : ${link}`;
    const copy = h('button', { type: 'button', class: 'btn-ghost' }, 'Copier le lien');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = 'Lien copié';
      } catch {
        copy.textContent = link;
      }
    });
    box.replaceChildren(
      h('strong', {}, n >= 4 ? 'Merci ! Fais-en profiter tes amis' : 'Merci pour ton avis'),
      stars(n),
      h('p', { class: 'hint' }, 'Chaque ami qui crée son CV avec ton lien vous rapporte des crédits bonus, à toi et à lui.'),
      h(
        'div',
        { class: 'invite-actions' },
        h('a', { class: 'btn-primary', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener' }, 'Inviter sur WhatsApp'),
        navigator.share ? h('button', { type: 'button', class: 'btn-ghost', onClick: () => navigator.share({ title: 'salacv', text: message, url: link }).catch(() => {}) }, 'Partager') : copy,
      ),
    );
  }

  if (previous) invite(previous.stars);
  else box.replaceChildren(h('strong', {}, 'Tu notes salacv combien ?'), h('p', { class: 'hint' }, 'Ton avis compte beaucoup pour nous.'), stars());
  return box;
}

function shareForTrial(resume) {
  let token = null;
  try {
    token = JSON.parse(localStorage.getItem('salacv:session') || 'null')?.token ?? null;
  } catch {}
  const { photo, ...profile } = resume.profile;
  fetch('/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ resume: { ...resume, profile } }),
    keepalive: true,
  }).catch(() => {}); // hors ligne : la génération ne dépend jamais de cet envoi
}
