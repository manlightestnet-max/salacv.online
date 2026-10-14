// Assistant en direct : l'étudiant PARLE, l'assistant lui répond à voix haute et remplit le CV pendant qu'il parle.
// Gemini Live API, en WebSocket directement depuis le navigateur (latence minimale) :
//   • le serveur donne un jeton éphémère (1 session, verrouillé sur nos consignes) : aucune clé dans la page ;
//   • micro → PCM 16 bits 16 kHz → Gemini ; Gemini → PCM 24 kHz → haut-parleur (coupé dès que l'étudiant reprend la parole) ;
//   • les outils du CV demandés par Gemini sont exécutés par le serveur (mêmes garde-fous que l'assistant écrit).
import { h } from './dom.js';
import { publishQuota } from './quotabar.js';
import { generateCard } from './gencard.js';
import { openShop } from './buy.js';

const MIC_RATE = 16000;
const OUT_RATE = 24000;
const SAID_KEPT = 4000; // transcription de l'étudiant gardée pour les garde-fous (demande explicite, coordonnées dictées)

// Capture du micro : ramène le flux à 16 kHz mono, en paquets de ~40 ms (Int16, little-endian).
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.ratio = sampleRate / ${MIC_RATE};
    this.pos = 0;
    this.out = new Int16Array(640);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let level = 0;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      level = Math.max(level, Math.abs(s));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(640);
        this.n = 0;
        level = 0;
      }
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('pcm16', Pcm16);
`;

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function post(body) {
  try {
    const res = await fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ ok: false, error: 'Réponse inattendue du serveur.' }));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { ok: false, error: 'Pas de connexion. Vérifie ton réseau et réessaie.' } };
  }
}

const CHANGE_LABELS = {
  identité: 'Identité',
  'profil professionnel': 'Profil',
  'formation & certifications': 'Formation',
  'expérience professionnelle': 'Expérience',
  'compétences & certifications': 'Compétences',
  langues: 'Langues',
  loisirs: 'Loisirs',
};

const SECTION = { education: 'Formation', experiences: 'Expérience' };
const INFO = new Set(['credits_info', 'credit_history']);
function toolLabel(name, a) {
  switch (name) {
    case 'set_identity':
      return 'Identité';
    case 'set_summary':
      return 'Profil professionnel';
    case 'add_entry':
      return `${SECTION[a.section] ?? 'Bloc'} · ajout`;
    case 'update_entry':
      return `${SECTION[a.section] ?? 'Bloc'} · retouche`;
    case 'remove_entry':
      return `${SECTION[a.section] ?? 'Bloc'} · suppression`;
    case 'edit_list':
      return a.section === 'hobbies' ? 'Loisirs' : 'Compétences';
    case 'set_languages':
      return 'Langues';
    case 'open_field':
      return 'J’ouvre la fenêtre…';
    case 'credits_info':
      return 'Crédits et prix';
    case 'credit_history':
      return 'Ton historique';
    case 'generate_cv':
      return 'Générer ton CV';
    case 'open_shop':
      return 'Recharger tes crédits';
    default:
      return 'Ton CV';
  }
}
const cut = (s, n = 90) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const joined = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : '');
function toolDetail(name, a) {
  switch (name) {
    case 'set_identity':
      return cut([a.name, a.title, a.email, joined(a.phones), a.address, a.link].filter(Boolean).join(' · '));
    case 'set_summary':
      return cut(a.text ?? '');
    case 'add_entry':
    case 'update_entry':
      return cut([a.period, a.title, a.org].filter(Boolean).join(' · ') || joined(a.details));
    case 'edit_list':
      return cut(`${a.mode === 'remove' ? '− ' : a.mode === 'replace' ? '= ' : '+ '}${joined(a.items)}`);
    case 'set_languages':
      return cut((a.languages ?? []).map((l) => (l?.level ? `${l.name} (${l.level})` : l?.name)).filter(Boolean).join(', '));
    default:
      return '';
  }
}
// Ce qu'un outil de lecture a trouvé, en une ligne pour la carte.
function infoLine(name, r) {
  if (!r || r.error) return r?.error ?? '';
  if (name === 'credits_info') {
    if (!r.connecte) return 'Visiteur : connexion nécessaire pour un CV propre';
    const prices = (r.packs ?? []).map((p) => `${p.credits} cr. ${p.prix.toLocaleString('fr-FR')} F`).join(' · ');
    return `Solde ${r.solde} · CV propre : ${r.coutCvPropre} crédit${prices ? ` · ${prices}` : ''}`;
  }
  if (name === 'credit_history') {
    if (!r.connecte) return 'Visiteur : pas d’historique';
    const n = r.mouvements?.length ?? 0;
    return n ? `${n} mouvement${n > 1 ? 's' : ''} · solde ${r.solde}` : 'Rien pour le moment';
  }
  return '';
}

// Ce que l'étudiant a écrit dans une partie (pour le dire à l'assistant, et dans la carte).
function written(part, cv) {
  const p = cv.profile ?? {};
  const items = (list) => (list ?? []).filter((i) => i.title || i.org).map((i) => [i.period, i.title, i.org].filter(Boolean).join(' · ')).join(' ; ');
  switch (part) {
    case 'identity':
      return [p.name, p.title].filter(Boolean).join(' · ');
    case 'contact':
      return [p.email, joined(p.phones), p.address].filter(Boolean).join(' · ');
    case 'summary':
      return cut(p.summary ?? '', 300);
    case 'education':
    case 'experiences':
      return cut(items(cv[part]), 400);
    case 'skills':
    case 'hobbies':
      return joined(cv[part]);
    case 'languages':
      return (cv.languages ?? []).filter((l) => l.name).map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ');
    case 'photo':
      return p.photo ? 'photo ajoutée' : 'pas de photo';
    default:
      return '';
  }
}
// L'étincelle de l'IA de salacv (même dessin que le bouton Assistant).
function spark() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '16');
  s.setAttribute('height', '16');
  s.setAttribute('class', 'ai-spark live-tool-spark');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path fill="currentColor" d="M12 2.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5z"/><path fill="currentColor" opacity=".75" d="M18.5 14c.25 1.9 1.3 2.95 3.2 3.2-1.9.25-2.95 1.3-3.2 3.2-.25-1.9-1.3-2.95-3.2-3.2 1.9-.25 2.95-1.3 3.2-3.2z"/>';
  return s;
}

// ctx : { getState(), setState(state), snapshot(), restore(snap), openField(spec, onDone), getFullState(),
//         getChat(), setChat(chat) (la conversation de ce CV, partagée avec l'assistant écrit), getContext() (versions),
//         renderState(version), session() (compte connecté ou null) }
export function createLive(ctx) {
  let ws = null;
  let ticket = null;
  let mic = null; // { stream, ctx, node }
  let speaker = null; // { ctx, next, sources:Set, gain }
  let said = '';
  let usage = 0; // tokens pas encore rapportés au serveur
  let snap = null; // le CV avant le direct (« Annuler tout »)
  let changed = false;
  let muted = false;
  let status = 'idle'; // idle | connecting | live | ended
  let timer = null;
  let startedAt = 0;
  let expiresAt = 0;
  let userLine = null;
  let botLine = null;
  let turn = { user: '', bot: '', changes: [] }; // ce tour, gardé dans la conversation du CV à sa fin

  // --- Interface ------------------------------------------------------------------------------
  const orb = h('div', { class: 'live-orb', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
  const state = h('strong', { class: 'live-status' }, 'En direct');
  const clock = h('span', { class: 'live-clock' }, '0:00');
  const log = h('div', { class: 'live-log', 'aria-live': 'polite' });
  const muteBtn = h('button', { type: 'button', class: 'live-btn-round', 'aria-pressed': 'false', title: 'Couper le micro' }, micIcon());
  const stopBtn = h('button', { type: 'button', class: 'live-stop' }, 'Terminer');
  const undoBtn = h('button', { type: 'button', class: 'btn-ghost live-undo', hidden: true }, 'Annuler tout');
  const closeBtn = h('button', { type: 'button', class: 'live-close', 'aria-label': 'Fermer', title: 'Fermer' }, '×');
  // Replié : une barre compacte (orbe, état, dernière phrase, micro, terminer) ; la discussion reste là, dépliable.
  const caption = h('span', { class: 'live-caption' });
  const foldBtn = h('button', { type: 'button', class: 'live-fold', 'aria-expanded': 'true', 'aria-label': 'Replier', title: 'Replier' }, chevron());
  const miniMute = h('button', { type: 'button', class: 'live-mini live-mini-mute', 'aria-pressed': 'false', 'aria-label': 'Couper le micro', title: 'Couper le micro' }, micIcon(false, 16));
  const miniStop = h('button', { type: 'button', class: 'live-mini live-mini-stop', 'aria-label': 'Terminer le direct', title: 'Terminer' }, h('span', { 'aria-hidden': 'true' }));
  const title = h('button', { type: 'button', class: 'live-title', 'aria-label': 'Déplier la discussion' }, h('span', { class: 'live-title-row' }, state, clock), caption);
  const panel = h(
    'section',
    { class: 'live-panel', role: 'dialog', 'aria-label': 'Assistant en direct', hidden: true },
    h('header', { class: 'live-head' }, orb, title, h('div', { class: 'live-mini-row' }, miniMute, miniStop), foldBtn, closeBtn),
    log,
    h('footer', { class: 'live-foot' }, muteBtn, undoBtn, stopBtn),
  );
  document.body.append(panel);

  // Préférence d'affichage (comme le thème) : replié ou déplié, retrouvé au prochain direct.
  const FOLD_KEY = 'salacv:live-folded';
  let folded = false;
  try {
    folded = localStorage.getItem(FOLD_KEY) === '1';
  } catch {}
  let autoFolded = false; // replié par une fenêtre du studio, pas par l'étudiant
  function setFolded(next, { remember = true } = {}) {
    folded = next;
    panel.classList.toggle('folded', folded);
    foldBtn.setAttribute('aria-expanded', String(!folded));
    foldBtn.setAttribute('aria-label', folded ? 'Déplier' : 'Replier');
    foldBtn.title = folded ? 'Déplier' : 'Replier';
    title.tabIndex = folded ? 0 : -1;
    panel.setAttribute('aria-label', folded ? 'Assistant en direct (replié) : toucher pour déplier' : 'Assistant en direct');
    if (!folded) log.scrollTop = log.scrollHeight;
    if (remember) {
      autoFolded = false;
      try {
        localStorage.setItem(FOLD_KEY, folded ? '1' : '0');
      } catch {}
    }
  }
  setFolded(folded, { remember: false });
  foldBtn.addEventListener('click', (e) => (e.stopPropagation(), setFolded(!folded)));
  title.addEventListener('click', () => folded && setFolded(false));

  // Mobile : replié, le direct n'est plus qu'une bulle (l'orbe), posée à droite juste au-dessus de la feuille du
  // formulaire (elle suit la feuille quand elle monte ou descend). Un toucher la déplie.
  const phone = window.matchMedia('(max-width: 640px)');
  const bubble = () => folded && phone.matches;
  panel.addEventListener('click', (e) => {
    if (!bubble() || e.target.closest('.live-mini')) return;
    setFolded(false);
  });
  function placeBubble() {
    const sheet = document.getElementById('sheet');
    const top = sheet?.getBoundingClientRect().top ?? innerHeight;
    // Feuille repliée : juste au-dessus ; feuille ouverte (elle couvre l'écran) : en bas, par-dessus.
    const above = sheet && top > innerHeight * 0.45 ? innerHeight - top + 12 : 16;
    panel.style.setProperty('--bubble-bottom', `${Math.round(above)}px`);
  }
  placeBubble();
  window.addEventListener('resize', placeBubble);
  const sheetEl = document.getElementById('sheet');
  if (sheetEl) new MutationObserver(() => requestAnimationFrame(placeBubble)).observe(sheetEl, { attributes: true, attributeFilter: ['data-state', 'class', 'style'] });
  sheetEl?.addEventListener('transitionend', placeBubble);

  // Une fenêtre du studio s'ouvre (saisie, recharge, export…) : le direct se replie pour lui laisser la place,
  // et se déplie de nouveau quand elle se ferme (s'il était déplié avant).
  new MutationObserver(() => {
    if (panel.hidden) return;
    const open = Boolean(document.querySelector('.dialog-backdrop:not(.closing)'));
    if (open && !folded) {
      setFolded(true, { remember: false });
      autoFolded = true;
    } else if (!open && autoFolded) {
      autoFolded = false;
      setFolded(false, { remember: false });
    }
  }).observe(document.body, { childList: true });

  function chevron() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '18');
    s.setAttribute('height', '18');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = '<path d="M6 9l6 6 6-6"/>';
    return s;
  }

  function micIcon(off = false, size = 20) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.innerHTML = `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>${off ? '<path d="M4 4l16 16"/>' : ''}`;
    return s;
  }

  function setStatus(next, text) {
    status = next;
    panel.dataset.status = next;
    state.textContent = text;
    window.dispatchEvent(new CustomEvent('salacv:live', { detail: { status: next } }));
  }

  function line(role, text = '') {
    const node = h('p', { class: `live-line live-${role}` }, text);
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  // La discussion d'avant (écrite ou en direct) sur ce CV : ses derniers échanges, en grisé, puis le direct reprend.
  function earlier() {
    const past = (ctx.getChat?.() ?? []).filter((m) => m.text && !m.error).slice(-6);
    if (!past.length) return;
    const box = h('div', { class: 'live-earlier' }, h('span', { class: 'live-earlier-label' }, 'Avant'));
    for (const m of past) box.append(h('p', { class: `live-line live-${m.role === 'user' ? 'user' : 'bot'}` }, m.text));
    log.append(box, h('div', { class: 'live-earlier-sep' }, h('span', {}, 'Reprise en direct')));
  }

  function note(text, cls = '') {
    const node = h('div', { class: `live-note ${cls}` }, text);
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function tick() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (expiresAt && Date.now() > expiresAt - 30_000) clock.classList.add('late');
  }

  // --- Audio ----------------------------------------------------------------------------------
  async function openMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ac = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ac.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = ac.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ac, 'pcm16');
    node.port.onmessage = ({ data }) => {
      orb.style.setProperty('--mic', String(Math.min(1, data.level * 3)));
      if (muted || ws?.readyState !== WebSocket.OPEN || status !== 'live') return;
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(data.pcm), mimeType: `audio/pcm;rate=${MIC_RATE}` } } }));
    };
    source.connect(node);
    // Le nœud doit aboutir quelque part pour tourner ; gain nul : on ne s'entend pas soi-même.
    const sink = ac.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ac.destination);
    mic = { stream, ctx: ac, node };
  }

  function openSpeaker() {
    const ac = new AudioContext({ sampleRate: OUT_RATE });
    const gain = ac.createGain();
    gain.connect(ac.destination);
    speaker = { ctx: ac, next: 0, sources: new Set(), gain };
  }

  function play(b64) {
    if (!speaker) return;
    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const buf = speaker.ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = speaker.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(speaker.gain);
    const at = Math.max(speaker.ctx.currentTime + 0.02, speaker.next);
    src.start(at);
    speaker.next = at + buf.duration;
    speaker.sources.add(src);
    panel.classList.add('speaking');
    src.onended = () => {
      speaker?.sources.delete(src);
      if (!speaker?.sources.size) panel.classList.remove('speaking');
    };
  }

  // L'étudiant coupe la parole : on se tait tout de suite.
  function hush() {
    if (!speaker) return;
    for (const s of speaker.sources) s.stop();
    speaker.sources.clear();
    speaker.next = 0;
    panel.classList.remove('speaking');
  }

  // --- Session --------------------------------------------------------------------------------
  async function start() {
    if (status === 'connecting' || status === 'live') return;
    panel.hidden = false;
    log.replaceChildren();
    caption.textContent = '';
    earlier();
    undoBtn.hidden = true;
    changed = false;
    said = '';
    usage = 0;
    userLine = botLine = null;
    turn = { user: '', bot: '', changes: [] };
    setStatus('connecting', 'Connexion…');
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      setStatus('ended', 'Indisponible');
      note('Ton navigateur ne permet pas le direct (micro). Essaie Chrome, Edge ou Safari récents.', 'err');
      return;
    }
    // Le micro d'abord : l'autorisation est demandée tant que le geste de l'utilisateur est « frais ».
    try {
      openSpeaker();
      await openMic();
    } catch (err) {
      cleanup();
      setStatus('ended', 'Micro refusé');
      note(err?.name === 'NotAllowedError' ? 'Autorise le micro pour parler à l’assistant (icône du cadenas, à gauche de l’adresse).' : 'Micro introuvable. Branche un micro et réessaie.', 'err');
      return;
    }
    snap = ctx.snapshot?.();
    const history = (ctx.getChat?.() ?? []).filter((m) => m.text && !m.error).slice(-16).map((m) => ({ role: m.role, text: m.text }));
    const { status: code, data } = await post({ action: 'start', state: ctx.getState(), history, context: { versions: ctx.getContext?.()?.versions ?? [] } });
    publishQuota(data.quota);
    if (!data.ok) {
      cleanup();
      setStatus('ended', 'Pas de direct');
      const n = note(data.error || 'Le direct n’a pas pu démarrer.', 'err');
      if (code === 401 || data.code === 'QUOTA') n.append(' ', h('a', { href: `/auth/?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Se connecter'));
      if (data.code === 'AI_QUOTA') n.append(' ', h('a', { href: '/dashboard/#credits' }, 'Recharger mon IA'));
      return;
    }
    ticket = data.ticket;
    expiresAt = data.expiresAt;
    connect(data);
  }

  function connect({ url, token, model }) {
    ws = new WebSocket(`${url}?access_token=${encodeURIComponent(token)}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      // La configuration est verrouillée dans le jeton par le serveur ; seul le modèle est rappelé ici.
      ws.send(JSON.stringify({ setup: { model } }));
    };
    ws.onmessage = async (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : ev.data instanceof Blob ? await ev.data.text() : new TextDecoder().decode(ev.data);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      onMessage(msg);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (status === 'ended') return;
      const why = ev.code === 1000 ? '' : ev.reason || `code ${ev.code}`;
      finish(why ? `Le direct s’est arrêté (${why}).` : 'Le direct est terminé.');
    };
  }

  function onMessage(msg) {
    if (msg.usageMetadata?.totalTokenCount) usage += msg.usageMetadata.totalTokenCount;
    if (msg.setupComplete) {
      setStatus('live', 'En direct');
      startedAt = Date.now();
      timer = setInterval(tick, 500);
      if (mic?.ctx.state === 'suspended') mic.ctx.resume();
      if (speaker?.ctx.state === 'suspended') speaker.ctx.resume();
      // L'assistant ouvre la conversation (il salue et pose sa première question).
      ws.send(JSON.stringify({ realtimeInput: { text: 'Bonjour !' } }));
      return;
    }
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        hush();
        botLine = null;
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && String(part.inlineData.mimeType ?? '').startsWith('audio/')) play(part.inlineData.data);
      }
      if (sc.inputTranscription?.text) {
        botLine = null;
        userLine ??= line('user');
        userLine.textContent += sc.inputTranscription.text;
        caption.textContent = `Toi : ${userLine.textContent.trim()}`;
        said = `${said}${sc.inputTranscription.text}`.slice(-SAID_KEPT);
        turn.user += sc.inputTranscription.text;
        log.scrollTop = log.scrollHeight;
      }
      if (sc.outputTranscription?.text) {
        userLine && (said += '\n');
        userLine = null;
        botLine ??= line('bot');
        botLine.textContent += sc.outputTranscription.text;
        caption.textContent = botLine.textContent.trim();
        turn.bot += sc.outputTranscription.text;
        log.scrollTop = log.scrollHeight;
      }
      if (sc.turnComplete) {
        botLine = null;
        userLine = null;
        keepTurn();
        report();
      }
    }
    if (msg.toolCall?.functionCalls?.length) runTools(msg.toolCall.functionCalls);
    if (msg.goAway) note('La session se termine bientôt.', 'soft');
  }

  // Aperçu des outils, au style de l'IA de salacv : ✦ pendant que l'assistant écrit, puis ✓ « Modifié : … » avec ce qu'il a mis.
  function toolCard(call) {
    const what = h('span', { class: 'live-tool-what' }, toolLabel(call.name, call.args ?? {}));
    const detail = h('span', { class: 'live-tool-detail' }, toolDetail(call.name, call.args ?? {}));
    const busy = h('span', { class: 'msg-typing live-tool-typing', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'));
    const card = h('div', { class: 'live-tool working' }, spark(), h('div', { class: 'live-tool-body' }, h('div', { class: 'live-tool-top' }, what, busy), detail));
    log.append(card);
    log.scrollTop = log.scrollHeight;
    const settle = (node) => {
      card.classList.remove('working');
      card.querySelector('.live-tool-top > :last-child')?.replaceWith(node);
      log.scrollTop = log.scrollHeight;
    };
    const ok = (text) => h('span', { class: 'msg-changes live-tool-ok' }, h('span', { class: 'msg-changes-mark', 'aria-hidden': 'true' }, '✓'), h('span', {}, text));
    return {
      done: (changes) => settle(ok(`Modifié : ${changes.map((c) => CHANGE_LABELS[c] ?? c).join(', ')}`)),
      opened(title, headline = `${title} : à toi d'écrire`, help = 'Écris dans la fenêtre, puis touche « Terminé ».') {
        card.classList.add('opened');
        what.textContent = headline;
        detail.textContent = help;
        settle(h('span', { class: 'live-tool-badge' }, 'Ouvert'));
      },
      finished(text, label = 'Rempli par toi') {
        card.classList.remove('opened');
        detail.textContent = text;
        settle(ok(label));
      },
      waiting: () => settle(h('span', { class: 'live-tool-badge wait' }, 'À confirmer')),
      failed(text) {
        card.classList.add('failed');
        if (text) detail.textContent = text;
        settle(h('span', { class: 'live-tool-badge muted' }, 'Pas appliqué'));
      },
    };
  }

  // « Laisse-moi l'écrire » : la fenêtre d'édition du studio s'ouvre sur cette partie, montrée sur l'aperçu.
  const PARTS = { identity: 'identity', contact: 'contact', summary: 'summary', skills: 'skills', hobbies: 'hobbies', photo: 'photo', education: 'item', experiences: 'item', languages: 'language' };
  function openField(call, card) {
    const { part, index } = call.args ?? {};
    const kind = PARTS[part];
    if (!kind || !ctx.openField) {
      card.failed('Cette partie ne s’ouvre pas.');
      return { error: 'Cette partie ne peut pas être ouverte.' };
    }
    const spec = { kind, ...(kind === 'item' ? { list: part } : {}), ...(Number.isInteger(index) ? { index } : {}) };
    let title = null;
    title = ctx.openField(spec, () => {
      // Fermée : on dit à l'assistant ce que l'étudiant a écrit (cette partie seulement).
      const wrote = written(part, ctx.getFullState?.() ?? ctx.getState());
      card.finished(wrote || 'Fenêtre fermée, rien d’écrit.');
      tell(`[L'étudiant a fermé la fenêtre « ${title} ». Ce qu'il y a maintenant : ${wrote || 'rien'}. Ces valeurs sont déjà dans le CV : ne les réenregistre pas.]`);
    });
    if (!title) {
      card.failed('L’aperçu n’est pas encore prêt.');
      return { error: 'L’aperçu n’est pas encore prêt : réessaie dans un instant.' };
    }
    card.opened(title);
    return { ok: true, opened: title, info: 'La fenêtre est ouverte : laisse-le écrire sans parler. On te dira quand il aura fini.' };
  }

  // Sauvegarde de la discussion : chaque tour fini rejoint la conversation de ce CV (la même que l'assistant écrit,
  // gardée avec le CV : compte sur le serveur, visiteur dans son bac à sable). Le prochain direct la reprend.
  function keepTurn() {
    const add = [];
    if (turn.user.trim()) add.push({ role: 'user', text: turn.user.trim(), live: true });
    if (turn.bot.trim() || turn.changes.length) add.push({ role: 'assistant', text: turn.bot.trim() || 'C’est fait.', live: true, ...(turn.changes.length ? { changes: [...new Set(turn.changes)] } : {}) });
    turn = { user: '', bot: '', changes: [] };
    if (add.length && ctx.setChat) ctx.setChat([...(ctx.getChat?.() ?? []), ...add]);
  }

  function attach(node) {
    log.append(node);
    log.scrollTop = log.scrollHeight;
  }

  // « Recharge » : la feuille habituelle (packs, MoMo, Airtel, LightPay), ouverte sur place. C'est l'étudiant qui paie.
  function shop(card, reason) {
    const who = ctx.session?.();
    if (!who) {
      card?.failed('Connecte-toi d’abord pour recharger.');
      attach(h('div', { class: 'live-note' }, h('a', { href: `/auth/?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Se connecter')));
      return { error: 'Visiteur non connecté : il doit d’abord se connecter (bouton « Se connecter »).' };
    }
    openShop({
      keyAccount: who.kind === 'key',
      note: reason ? `Pour ${reason}.` : '',
      onPaid: async (order) => {
        const bal = await fetch('/api/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then((r) => r.json())
          .then((d) => d.balance)
          .catch(() => null);
        card?.finished(`+${order.credits} crédit${order.credits > 1 ? 's' : ''}${bal != null ? ` · solde ${bal}` : ''}`, 'Payé');
        tell(`[Achat réussi : +${order.credits} crédits${bal != null ? `, nouveau solde ${bal}` : ''}. Félicite-le en une phrase et propose de générer son CV.]`);
      },
    });
    card?.opened('Recharge', 'La fenêtre de paiement est ouverte', 'Choisis ton pack et paie (MTN MoMo, Airtel Money, LightPay).');
    return { ok: true, info: 'La fenêtre de recharge est ouverte. Laisse-le choisir et payer ; on te dira si c’est payé. S’il ferme sans payer, ne force pas.' };
  }

  // Les appels de Gemini, un par un, sur le CV tel qu'il est à l'écran ; la réponse repart à Gemini.
  async function runTools(calls) {
    const responses = [];
    for (const call of calls) {
      const card = toolCard(call);
      if (call.name === 'open_field') {
        responses.push({ id: call.id, name: call.name, response: { result: openField(call, card) } });
        continue;
      }
      if (call.name === 'open_shop') {
        responses.push({ id: call.id, name: call.name, response: { result: shop(card, call.args?.reason) } });
        continue;
      }
      const context = call.name === 'generate_cv' ? { versions: ctx.getContext?.()?.versions ?? [] } : undefined;
      const { data } = await post({ action: 'tool', ticket, state: ctx.getState(), name: call.name, args: call.args ?? {}, said, context });
      let response;
      if (!data.ok) {
        response = { error: data.error || 'Échec.' };
        card.failed(data.error);
      } else {
        response = data.result?.pending ? { pending: true, info: data.result.info } : data.result;
        if (data.generate) {
          // Générer : la carte habituelle ; c'est lui qui touche « Générer » (le serveur revérifie et débite).
          card.finished(data.generate.enough ? 'Touche « Générer mon CV » ci-dessous.' : data.generate.loggedIn ? 'Pas assez de crédits : PDF avec filigrane, ou recharge.' : 'Visiteur : PDF avec filigrane.', 'Prêt');
          attach(
            generateCard(data.generate, {
              renderState: ctx.renderState,
              onRecharge: () => shop(null, 'ton CV propre'),
              onReady: ({ watermarked }) => tell(`[Son CV est prêt à télécharger${watermarked ? ', avec filigrane' : ''}.]`),
            }),
          );
        } else if (INFO.has(call.name)) {
          if (data.result?.error) card.failed(data.result.error);
          else card.finished(infoLine(call.name, data.result), 'Consulté');
        } else if (data.changes?.length) {
          ctx.setState(data.state);
          changed = true;
          undoBtn.hidden = false;
          turn.changes.push(...data.changes);
          card.done(data.changes);
        } else if (data.pending) card.waiting();
        else card.failed(data.result?.error ? 'L’assistant corrige…' : '');
        if (data.pending) confirmCard(data.pending);
      }
      responses.push({ id: call.id, name: call.name, response: { result: response } });
    }
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }

  // Un changement qui retire ou remplace ce que l'étudiant avait écrit : il confirme d'un geste (même chemin que l'assistant écrit).
  function confirmCard(pending) {
    const ok = h('button', { type: 'button', class: 'btn-primary' }, 'Confirmer');
    const no = h('button', { type: 'button', class: 'btn-ghost' }, 'Non');
    const card = h('div', { class: 'live-note live-confirm' }, h('ul', {}, ...(pending.lines ?? []).map((l) => h('li', {}, l))), h('div', { class: 'live-confirm-row' }, ok, no));
    ok.addEventListener('click', async () => {
      ok.disabled = no.disabled = true;
      let data;
      try {
        const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: ctx.getState(), confirm: pending }) });
        data = await res.json();
      } catch {
        data = { ok: false, error: 'Pas de connexion.' };
      }
      if (data.ok && data.state) {
        ctx.setState(data.state);
        changed = true;
        undoBtn.hidden = false;
        card.replaceChildren('✓ Confirmé');
        tell('[L’étudiant a touché « Confirmer » : le changement est appliqué.]');
      } else {
        card.replaceChildren(data.error || 'Impossible d’appliquer ce changement.');
      }
    });
    no.addEventListener('click', () => {
      card.replaceChildren('Changement refusé');
      tell('[L’étudiant a refusé ce changement : rien n’a été modifié.]');
    });
    log.append(card);
    log.scrollTop = log.scrollHeight;
  }

  function tell(text) {
    if (ws?.readyState === WebSocket.OPEN && status === 'live') ws.send(JSON.stringify({ realtimeInput: { text } }));
  }

  async function report(end = false) {
    if ((!usage && !end) || !ticket) return;
    const tokens = usage;
    usage = 0;
    // Fin de session : le compte rendu doit partir même si la page se ferme.
    if (end && navigator.sendBeacon?.('/api/live', new Blob([JSON.stringify({ action: 'usage', ticket, tokens, end: true })], { type: 'application/json' }))) return;
    const { data } = await post({ action: 'usage', ticket, tokens, ...(end ? { end: true } : {}) });
    publishQuota(data.quota);
    if (data.stop) finish('Ton IA est à court : le direct s’arrête.');
  }

  function cleanup() {
    clearInterval(timer);
    timer = null;
    mic?.stream.getTracks().forEach((t) => t.stop());
    mic?.ctx.close().catch(() => {});
    mic = null;
    hush();
    speaker?.ctx.close().catch(() => {});
    speaker = null;
  }

  function finish(text) {
    if (status === 'ended' || status === 'idle') return;
    setStatus('ended', 'Terminé');
    keepTurn();
    report(true);
    ticket = null;
    const sock = ws;
    ws = null;
    if (sock && sock.readyState <= WebSocket.OPEN) sock.close(1000);
    cleanup();
    if (text) note(text, 'soft');
    const again = h('button', { type: 'button', class: 'btn-primary live-again' }, 'Relancer le direct');
    again.addEventListener('click', () => start());
    log.append(again);
    log.scrollTop = log.scrollHeight;
  }

  function close() {
    finish();
    setStatus('idle', 'En direct');
    panel.hidden = true;
  }

  function toggleMute() {
    muted = !muted;
    panel.classList.toggle('muted', muted);
    for (const [btn, size] of [[muteBtn, 20], [miniMute, 16]]) {
      btn.setAttribute('aria-pressed', String(muted));
      btn.title = muted ? 'Rallumer le micro' : 'Couper le micro';
      btn.setAttribute('aria-label', btn.title);
      btn.replaceChildren(micIcon(muted, size));
    }
    if (muted && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }
  muteBtn.addEventListener('click', toggleMute);
  miniMute.addEventListener('click', toggleMute);
  stopBtn.addEventListener('click', () => finish('Direct terminé.'));
  miniStop.addEventListener('click', () => finish('Direct terminé.'));
  closeBtn.addEventListener('click', close);
  undoBtn.addEventListener('click', () => {
    if (!snap || !changed) return;
    ctx.restore?.(snap);
    changed = false;
    undoBtn.hidden = true;
    note('Le CV est revenu comme avant le direct.', 'soft');
    tell('[L’étudiant a annulé toutes les modifications faites pendant le direct : le CV est revenu comme au début.]');
  });
  window.addEventListener('pagehide', () => finish());

  // Développement seulement (retiré du build) : rejouer des appels d'outils sans micro ni Gemini.
  const test = import.meta.env?.DEV
    ? { show: () => ((panel.hidden = false), log.replaceChildren(), earlier(), setStatus('live', 'En direct (test)')), runTools, line, caption, setTicket: (t) => (ticket = t), tell: (t) => line('bot', t) }
    : undefined;

  return { test, start, close, toggle: () => (status === 'connecting' || status === 'live' ? close() : start()), get status() { return status; } };
}
