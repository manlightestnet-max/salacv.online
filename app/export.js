// « Préparer mon CV » : jamais de téléchargement direct. Le CV est GÉNÉRÉ PAR LE SERVEUR, qui décide des droits :
//   • visiteur non connecté, ou compte sans crédit → PDF avec filigrane, Word bloqué ;
//   • compte avec crédit → PDF propre et Word (1 crédit par version, re-télécharger la même version est gratuit).
// L'étudiant suit la préparation étape par étape, puis télécharge lui-même ses fichiers. Ensuite : une note en étoiles.
import { h, icon } from './dom.js';
import { openDialog } from './dialog.js';
import { toResume } from './state.js';
import { inviteLink, sendFeedback } from './lib/store.js';
import { readSession } from './login.js';

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

const toBlob = (base64, type) => new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type });
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// Appel du serveur de génération (avec le jeton s'il y en a un).
async function callRender(payload) {
  try {
    const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: res.status, data: await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' })) };
  } catch {
    return { status: 0, data: { ok: false, error: 'Pas de connexion Internet. Vérifie ton réseau puis réessaie.' } };
  }
}

export async function openExport({ state, onSpent, missing = [], onReview }) {
  const desktop = getDesktop();
  const resume = toResume(state);
  const name = resume.profile.name || 'CV';
  let withWord = false;

  const body = h('div', { class: 'export' });
  const foot = h('div', { class: 'export-foot' });
  const dialog = openDialog({ title: 'Préparer mon CV', className: 'export-dialog', content: body, footer: foot });
  const cancel = h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Annuler');
  const here = `/auth/?next=${encodeURIComponent(location.pathname + location.search)}`;

  function failure(message, retry) {
    body.replaceChildren(h('p', { class: 'export-error' }, message));
    foot.replaceChildren(h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Fermer'), retry && h('button', { type: 'button', class: 'btn-primary', onClick: retry }, 'Réessayer'));
  }

  // --- 1. Droits (annoncés par le serveur) et choix du format -------------------------------------
  async function choose() {
    body.replaceChildren(h('p', { class: 'hint' }, 'Vérification de tes droits…'));
    foot.replaceChildren(cancel);
    const { data: info } = await callRender({ state, dryRun: true });
    if (!info.ok) return failure(info.error || 'Impossible de vérifier tes droits.', choose);
    const watermark = info.entitlement === 'watermark';

    const wordCard = info.wordAllowed
      ? h(
          'button',
          { type: 'button', class: 'format-card', 'aria-pressed': String(withWord), onClick: () => wordToggle.setAttribute('aria-pressed', String((withWord = !withWord))) },
          h('span', { class: 'format-badge' }, 'DOCX'),
          h('span', { class: 'format-text' }, h('strong', {}, 'Aussi en Word'), h('small', {}, 'Une version modifiable, une colonne')),
          h('span', { class: 'format-check', 'aria-hidden': 'true' }),
        )
      : h(
          'div',
          { class: 'format-card locked', 'aria-disabled': 'true' },
          h('span', { class: 'format-badge' }, 'DOCX'),
          h('span', { class: 'format-text' }, h('strong', {}, 'Word (verrouillé)'), h('small', {}, info.loggedIn ? 'Réservé aux CV débloqués avec un crédit' : 'Réservé aux comptes connectés')),
          icon('lock', 16),
        );
    const wordToggle = wordCard;
    withWord = info.wordAllowed ? withWord : false;

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

    const cost = watermark
      ? h(
          'div',
          { class: 'cost empty' },
          h('span', {}, h('strong', {}, 'PDF avec filigrane. '), info.reason),
          info.loggedIn ? h('a', { class: 'cost-link', href: '/dashboard/#credits' }, 'Mes crédits') : h('a', { class: 'cost-link', href: here }, 'Se connecter'),
        )
      : h(
          'div',
          { class: 'cost' },
          info.cost > 0 ? h('span', {}, h('strong', {}, `${info.cost} crédit`), ` · il t'en restera ${info.balance - info.cost}`) : h('span', {}, 'Cette version est déjà préparée : ', h('strong', {}, 'gratuit')),
          h('a', { class: 'cost-link', href: '/dashboard/#credits' }, 'Mes crédits'),
        );

    body.replaceChildren(
      advice || '',
      h(
        'div',
        { class: 'format-card static', 'aria-pressed': 'true' },
        h('span', { class: 'format-badge' }, 'PDF'),
        h('span', { class: 'format-text' }, h('strong', {}, watermark ? 'PDF avec filigrane' : 'PDF haute qualité'), h('small', {}, watermark ? 'Vectoriel, avec le filigrane « salacv.online »' : 'Vectoriel, sans filigrane, prêt à envoyer')),
        h('span', { class: 'format-check', 'aria-hidden': 'true' }),
      ),
      wordCard,
      cost,
      h('p', { class: 'trial-note' }, 'Phase d’essai : les CV générés sont conservés (sans photo) et utilisés pour améliorer salacv.'),
    );
    foot.replaceChildren(cancel, h('button', { type: 'button', class: 'btn-primary', 'data-autofocus': true, onClick: () => prepare(watermark) }, watermark ? 'Préparer mon PDF avec filigrane' : 'Préparer mon PDF'));
  }

  // --- 2. Génération par le serveur, avec progression -----------------------------------------------
  async function prepare(watermark) {
    const steps = [
      ['check', 'Vérification de tes informations'],
      ['layout', 'Mise en page'],
      ['fonts', 'Intégration des polices'],
      ['pdf', watermark ? 'Génération du PDF (avec filigrane)' : 'Génération du PDF vectoriel'],
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
      const pending = callRender({ state, formats: withWord ? ['pdf', 'docx'] : ['pdf'] }); // le serveur travaille pendant que les étapes défilent
      await advance(async () => {
        if (!resume.profile.name) throw new Error('Ton nom manque.');
      });
      await advance(() => pause(0));
      await advance(() => pause(0));
      const { data } = await advance(() => pending); // l'étape « PDF » attend le serveur
      if (!data.ok) throw new Error(data.error || 'La préparation a échoué.');
      if (withWord) await advance(() => pause(0));
      await advance(async () => {
        // Phase d'essai : le CV (sans photo) est conservé pour améliorer salacv (annoncé plus haut).
        shareForTrial(resume);
        if (data.balance != null) onSpent?.(data.balance);
      });
      ready(data);
    } catch (err) {
      rows[i]?.classList.replace('active', 'failed');
      body.append(h('p', { class: 'export-error' }, err.message || 'La préparation a échoué.', ' Aucun crédit n’a été utilisé.'));
      foot.replaceChildren(h('button', { type: 'button', class: 'btn-ghost', onClick: () => dialog.close() }, 'Fermer'), h('button', { type: 'button', class: 'btn-primary', onClick: choose }, 'Réessayer'));
    }
  }

  // --- 3. Prêt : l'étudiant télécharge lui-même ---------------------------------------------------
  function ready(data) {
    const file = slug(name) || 'CV';
    const wm = data.files.pdf.watermarked;
    const pdfBlob = toBlob(data.files.pdf.base64, MIME.pdf);
    const docxBlob = data.files.docx ? toBlob(data.files.docx.base64, MIME.docx) : null;
    const pdfLabel = wm ? 'PDF (avec filigrane)' : 'PDF';
    body.replaceChildren(
      h('div', { class: 'ready' }, h('span', { class: 'ready-icon', 'aria-hidden': 'true' }), h('strong', {}, wm ? 'Ton CV est prêt (avec filigrane)' : 'Ton CV est prêt'), h('p', {}, desktop ? 'Choisis où l’enregistrer.' : 'Télécharge-le quand tu veux.')),
      h(
        'div',
        { class: 'ready-files' },
        desktop
          ? fileRow(pdfBlob, `CV-${file}.pdf`, pdfLabel, true)
          : h('button', { type: 'button', class: 'btn-primary btn-lg', 'data-autofocus': true, onClick: () => save(pdfBlob, `CV-${file}.pdf`) }, `Télécharger le PDF${wm ? ' (avec filigrane)' : ''}`),
        docxBlob && (desktop ? fileRow(docxBlob, `CV-${file}.docx`, 'Word', false) : h('button', { type: 'button', class: 'btn-ghost btn-lg', onClick: () => save(docxBlob, `CV-${file}.docx`) }, 'Télécharger le Word')),
        data.blocked?.docx && h('p', { class: 'hint locked-note' }, icon('lock', 14), ` ${data.blocked.docx}`),
      ),
      wm &&
        h(
          'div',
          { class: 'cost empty' },
          h('span', {}, data.reason),
          data.loggedIn ? h('a', { class: 'cost-link', href: '/dashboard/#credits' }, 'Mes crédits') : h('a', { class: 'cost-link', href: here }, 'Se connecter'),
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
  const previous = null; // l'avis est gardé par le serveur (un par personne, modifiable) : on repart d'un écran neuf

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
    sendFeedback(n);
    if (n >= 4) return invite(n);
    const text = h('textarea', { class: 'input', rows: 3, placeholder: 'Qu’est-ce qui t’a gêné ?' });
    box.replaceChildren(
      h('strong', {}, 'Merci. Qu’est-ce qu’on peut améliorer ?'),
      stars(n),
      text,
      h('button', { type: 'button', class: 'btn-ghost', onClick: () => (sendFeedback(n, text.value.trim()), invite(n)) }, 'Envoyer'),
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
      h('p', { class: 'hint' }, 'Un CV propre, en quelques minutes : partage salacv avec ta promo.'),
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
  const { photo, ...profile } = resume.profile;
  fetch('/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume: { ...resume, profile } }),
    keepalive: true,
  }).catch(() => {}); // hors ligne : la génération ne dépend jamais de cet envoi
}

export { callRender, toBlob, MIME, save, slug, getDesktop, fileRow, shareForTrial };
