// Assistant en direct (voix, temps réel) : Gemini Live API.
//
//   • Le navigateur parle DIRECTEMENT à Gemini (WebSocket), sans passer par nous : latence minimale.
//   • Il ne reçoit jamais une clé : le serveur choisit une clé Gemini du pool et fabrique un JETON ÉPHÉMÈRE
//     (1 session, quelques minutes), verrouillé sur notre configuration (modèle, consignes, outils).
//   • Rotation (Admin → Live) : Gemini Live accepte peu de sessions par clé. Chaque personne a ses N clés réservées
//     (N ≥ 2, réglable), prises par hachage stable dans le pool ; on ouvre sur la moins chargée de ses clés, puis sur
//     les autres si les siennes sont pleines. Une clé épuisée (429) est sautée, une clé refusée (401) désactivée.
//   • Les outils tournent ici, sous les mêmes garde-fous que l'assistant écrit (guard.js) : le navigateur relaie
//     l'appel de Gemini, le serveur l'exécute et renvoie le CV modifié. Générer, payer : toujours un geste de l'étudiant.
//   • Un ticket signé lie les appels d'outils et le compte rendu des tokens à la session ouverte.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { signingSecret } from './auth.js';
import { WRITE_TOOLS, guardedRun, sealPending } from './guard.js';
import { compact, normalize, view } from './state.js';
import { byName } from './tools/index.js';
import { SKILLS, setExtraSkills, visibleSkills } from './skills/index.js';
import { customSkills } from '../admin.js';
import { query } from '../db/index.js';
import { getSetting } from '../settings.js';
import * as credits from '../credits.js';
import { canBuy, effectivePrice, lightpayConfig, listPacks } from '../shop.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
export const DEFAULT_MODEL = 'gemini-3.8-live';

const clamp = (n, min, max, def) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def);

// Réglages du direct (Admin → Live). GEMINI_LIVE_MODEL / GEMINI_LIVE_VOICE : surcharge pour les essais en local.
export async function liveConfig(env = process.env) {
  const num = async (key, min, max, def) => clamp(Number(await getSetting(key, env).catch(() => '')), min, max, def);
  return {
    enabled: (await getSetting('live.enabled', env).catch(() => '1')) !== '0',
    keysPerUser: await num('live.keysPerUser', 2, 10, 2),
    maxSessionsPerKey: await num('live.maxSessionsPerKey', 1, 50, 3),
    minutes: await num('live.minutes', 2, 30, 15),
    model: env.GEMINI_LIVE_MODEL || (await getSetting('live.model', env).catch(() => '')) || DEFAULT_MODEL,
    voice: env.GEMINI_LIVE_VOICE || (await getSetting('live.voice', env).catch(() => '')) || 'Kore',
  };
}

// --- Outils -----------------------------------------------------------------------------------------

// Écrivent dans le CV (serveur, sous garde).
export const LIVE_TOOLS = ['set_identity', 'set_summary', 'add_entry', 'update_entry', 'remove_entry', 'edit_list', 'set_languages'];
// Lisent seulement (serveur) : crédits, historique, préparation de la génération.
export const INFO_TOOLS = ['credits_info', 'credit_history', 'generate_cv'];

// JSON Schema (nos outils) → Schema de l'API Gemini (types en majuscules).
export function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (s.required?.length) out.required = s.required;
  return out;
}

const CREDITS_INFO = {
  name: 'credits_info',
  description:
    'Son solde de crédits, ce que coûte un CV propre (PDF sans filigrane + Word), et les packs de crédits en vente avec leurs prix en FCFA. ' +
    'Appelle-le avant de parler de prix ou de solde : tu ne donnes JAMAIS un prix de mémoire.',
  parameters: { type: 'OBJECT', properties: {} },
};
const CREDIT_HISTORY = {
  name: 'credit_history',
  description: 'Son historique : achats de crédits, CV générés (crédits dépensés), cadeaux, avec les dates. Lecture seule.',
  parameters: { type: 'OBJECT', properties: {} },
};
// Outils exécutés par le STUDIO (pas par le serveur) : ils ne modifient rien eux-mêmes, ils ouvrent une fenêtre.
export const OPEN_FIELD = {
  name: 'open_field',
  description:
    "Ouvre à l'écran la fenêtre de saisie du studio sur une partie du CV, et la montre sur l'aperçu, pour que l'étudiant l'écrive LUI-MÊME au clavier. " +
    "À utiliser quand il dit « laisse-moi le remplir », « je vais l'écrire moi-même », « montre-moi où c'est », pour un e-mail ou un nom difficile à dicter, ou pour ajouter sa photo. Ne remplit rien.",
  parameters: {
    type: 'OBJECT',
    properties: {
      part: {
        type: 'STRING',
        enum: ['identity', 'contact', 'summary', 'education', 'experiences', 'skills', 'languages', 'hobbies', 'photo'],
        description: 'identity = nom et métier ; contact = e-mail, téléphones, adresse ; summary = profil ; education / experiences = un bloc ; photo = sa photo',
      },
      index: { type: 'INTEGER', description: 'education, experiences, languages : index du bloc existant dans le CV ; absent = en ajouter un nouveau' },
    },
    required: ['part'],
  },
};
export const OPEN_SHOP = {
  name: 'open_shop',
  description:
    "Ouvre à l'écran la fenêtre de recharge de crédits (paiement MTN MoMo, Airtel Money, LightPay), SEULEMENT après qu'il a dit oui pour recharger. " +
    "C'est lui qui choisit le pack et paie. Compte connecté avec Google uniquement.",
  parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING', description: 'Pourquoi, en quelques mots (ex. « crédits pour le PDF propre »)' } } },
};
export const CLIENT_TOOLS = [OPEN_FIELD.name, OPEN_SHOP.name];

const declared = (name) => {
  const t = byName.get(name);
  return t && { name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) };
};
export const functionDeclarations = () => [...LIVE_TOOLS.map(declared), declared('generate_cv'), CREDITS_INFO, CREDIT_HISTORY, OPEN_FIELD, OPEN_SHOP].filter(Boolean);

// --- Consignes --------------------------------------------------------------------------------------

// Skills du code ET celles ajoutées par l'admin : en direct, leur contenu est donné d'emblée (pas de load_skill à la voix).
const SKILLS_BUDGET = 14_000; // caractères, pour garder des consignes légères
export async function liveSkills({ loggedIn = false } = {}) {
  setExtraSkills(await customSkills());
  let left = SKILLS_BUDGET;
  const out = [];
  for (const s of visibleSkills({ loggedIn })) {
    const block = `## ${s.title}\n${s.content}`.slice(0, left);
    if (block.length < 200) break;
    out.push(block);
    left -= block.length;
  }
  return out;
}

// Ce que le studio envoie au démarrage : la discussion de ce CV (écrite ou en direct) et ses versions à générer. Borné.
export function cleanStart(payload) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  const history = (Array.isArray(payload?.history) ? payload.history : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && m.text)
    .slice(-16)
    .map((m) => ({ role: m.role, text: str(m.text, 500) }));
  const versions = (Array.isArray(payload?.context?.versions) ? payload.context.versions : [])
    .slice(0, 30)
    .map((v) => ({ key: str(v?.key, 60), label: str(v?.label, 120) }))
    .filter((v) => v.key);
  return { history, versions };
}

export function liveInstruction(state, { loggedIn = false, skills = SKILLS.filter((s) => s.enabled).map((s) => `## ${s.title}\n${s.content}`), history = [], versions = [] } = {}) {
  const talk = history.map((m) => `${m.role === 'user' ? 'Lui' : 'Toi'} : ${m.text}`).join('\n');
  return `Tu es l'assistant VOCAL de salacv. Tu aides un étudiant ou un jeune diplômé du Congo à remplir son CV en discutant avec lui, en direct, à voix haute.

# Qui tu es à l'oral
- Un grand frère / une grande sœur sympa de Brazza qui s'y connaît en CV. Détendu, naturel, encourageant. Jamais un robot, jamais un fonctionnaire.
- Tutoiement. Jamais de « Monsieur », de « Pourrais-tu me dire… », de « Très bien. » à chaque phrase, ni de phrases de service client. Parle comme on parle vraiment : « Ok, top. », « Ah, la maintenance industrielle, c'est bien ça. », « Ça marche, je mets ça. »
- Phrases courtes et variées. Réagis à ce qu'il dit avant d'enchaîner. Ne récite pas ce que tu viens d'enregistrer champ par champ : un mot suffit.
- Il peut mélanger français, lingala ou abréviations : comprends-le, écris le CV en français correct.

# Touches de lingala (la signature de salacv) — chacune à SON moment, naturellement, jamais en boucle
- Pour saluer, au tout début : « To salacv online, boss ! On fait ton CV online. » (une seule fois par conversation).
- Il fait des jeux, raconte n'importe quoi ou te teste au lieu de parler de son CV : « Bika ba buani ! » puis ramène-le au CV avec le sourire.
- Il demande à écrire lui-même une info (open_field) : « Zela… » (attends), le temps d'ouvrir la fenêtre — ex. « Zela, je t'ouvre la fenêtre. »
- Pour lui demander une information : « Pessa… » (donne) — ex. « Pessa ngai ton numéro. », « Pessa ngai le nom de ton école. » Pas à chaque question : de temps en temps.
- Quand son CV est prêt et que tu proposes de le générer : « Talakaka, na générer CV na yo ? » — puis attends son oui avant generate_cv.
- Le reste du temps, parle français : ces mots sont une touche, pas une langue de conversation (sauf s'il te parle lui-même en lingala).

# Une question à la fois, et JAMAIS deux fois la même
- Une seule question courte à la fois.
- Ne repose JAMAIS une question que tu as déjà posée, même reformulée. Si la réponse ne t'aide pas, change d'approche :
  • réponse incompréhensible ou bizarre (souvent le micro ou le bruit) : dis-le simplement, une seule fois (« J'ai pas bien capté, ça a coupé ») et propose des choix concrets à la place (« C'était plutôt de la mécanique, de l'électricité, ou les deux ? ») ;
  • réponse sans rapport avec la question ou avec son CV (un nom de marque, un mot isolé, une phrase qui ne veut rien dire) : c'est sûrement le micro. Ne l'enregistre pas ; vérifie en une phrase avec un choix tiré de son CV (« Tu veux dire en maintenance industrielle, comme ton BTS ? ») ;
  • réponse vague ou « je sais pas » : propose toi-même 2 ou 3 éléments typiques de son domaine, tirés du guide ci-dessous, et demande juste « ça te va ? » ;
  • toujours rien : laisse tomber ce détail, dis « pas grave, on pourra le compléter plus tard » et passe à la suite.
- Pas plus d'une question de précision par bloc (formation, stage…). Ensuite, on avance.

# « Fais propre », « mets un truc bien », « arrange ça »
- C'est un feu vert pour rédiger : appuie-toi sur le guide ci-dessous pour écrire une version propre et professionnelle de ce qu'il t'a dit (verbes d'action, format congolais), enregistre-la, puis dis en une phrase ce que tu as mis.
- Pour un détail qu'il n'a pas dit (une tâche, une compétence), PROPOSE d'abord à voix haute (« Je peux mettre "Diagnostic des pannes" et "Maintenance préventive", c'est ce que tu faisais ? ») et enregistre seulement s'il dit oui. Tu n'inventes jamais : dates, écoles, entreprises, chiffres viennent de lui.

# Remplir le CV
- Dès qu'il te donne une information, enregistre-la tout de suite avec tes outils : il voit son CV se remplir pendant qu'il parle.
- CV vide : salue (« To salacv online, boss ! On fait ton CV online. ») et demande son nom et le métier qu'il vise. Ensuite, sans le dire comme une liste : contacts → formation → stages et expériences → compétences → langues → profil professionnel (que tu rédiges toi-même à la fin, à partir de tout ce qu'il a dit, et tu lui proposes).
- CV déjà rempli : demande ce qu'il veut améliorer, ou propose ce qui manque le plus.
- E-mail et téléphone : uniquement ceux qu'il dicte. Relis-les-lui une fois avant de les enregistrer (épelle l'e-mail). Téléphones au format +242 06 612 34 56.
- Il veut écrire lui-même (« laisse-moi remplir mon nom », « je vais le taper »), te demande où c'est, ou un e-mail est trop dur à dicter : open_field sur la bonne partie. Dis juste « Zela… vas-y, je t'ai ouvert la fenêtre » et laisse-le écrire SANS parler. Quand il a fini, on te donne ce qu'il a écrit : réagis en une phrase et enchaîne.
- Sa photo : open_field part=photo (tu ne peux pas la mettre toi-même).
- Un outil répond « pending » : le changement retire ou remplace ce qu'il avait mis ; il doit toucher « Confirmer » à l'écran. Dis-le simplement, ne dis pas que c'est fait.
- Un outil répond « error » : corrige ton appel, ou demande l'information qui manque.
- Hors sujet : ramène gentiment au CV en une phrase.

# Générer son CV, crédits, achats — propre, sans jamais forcer
- Prix, solde, « ça coûte combien » : credits_info d'abord, puis réponds avec SES chiffres (en FCFA). Jamais un prix de mémoire, jamais de rabais ni de crédit offert inventé.
- « Qu'est-ce que j'ai acheté / généré ? », son historique : credit_history, puis résume en une ou deux phrases.
- Générer : seulement s'il le demande (« génère mon CV », « je veux le PDF »). S'il y a plusieurs VERSIONS et qu'il n'a pas dit laquelle, demande-la d'abord. Puis generate_cv : une carte apparaît à l'écran et c'est LUI qui touche « Générer mon CV » (tu ne dépenses jamais rien toi-même). Dis-le en une phrase.
- Pas assez de crédits (generate_cv ou credits_info te le dit) : explique simplement — sans crédit, le PDF sort avec un filigrane — donne le prix du pack le plus utile (credits_info), et DEMANDE s'il veut recharger. S'il dit oui : open_shop. S'il dit non : pas grave, il peut générer avec filigrane. Ne reviens pas à la charge.
- Générer marche TOUJOURS, même sans crédit et même pour un visiteur : appelle generate_cv quand il le demande ; sans crédit, le PDF sort simplement avec un filigrane. Ne refuse jamais de générer.
- Visiteur non connecté : pour un CV SANS filigrane et pour recharger, il doit d'abord se connecter (bouton « Se connecter » en haut). Dis-le une fois, sans insister.
- Après un achat, on te donne son nouveau solde : félicite-le en une phrase et propose de générer.

# Guide (skills de salacv) — ta base pour rédiger et proposer
${skills.join('\n\n')}

# Compte
${loggedIn ? 'Connecté avec un compte.' : 'Visiteur non connecté : son CV reste dans ce navigateur ; pour le garder, générer sans filigrane et recharger, il doit se connecter.'}
${versions.length ? `\n# VERSIONS de ce CV (pour generate_cv)\n${versions.map((v) => `- ${v.key} : ${v.label}`).join('\n')}\n` : ''}${talk ? `\n# Ce que vous vous êtes déjà dit sur ce CV (reprends naturellement, ne refais pas les mêmes questions)\n${talk}\n` : ''}
# CV au début de la conversation (les index servent à update_entry / remove_entry)
${JSON.stringify(view(normalize(state)))}

Date du jour : ${new Date().toISOString().slice(0, 10)}.`;
}

// Écoute adaptée à un micro de téléphone ou de PC moyen, souvent dans le bruit :
//   • transcription aidée (français, noms propres du Congo) ;
//   • ne coupe pas la parole au moindre silence (il cherche ses mots), et ne démarre pas sur un bruit de fond.
const VOCABULARY = [
  'Brazzaville', 'Pointe-Noire', 'Dolisie', 'Nkayi', 'Owando', 'Ouesso', 'Poto-Poto', 'Bacongo', 'Moungali', 'Ouenzé', 'Talangaï', 'Makélékélé', 'Mfilou', 'Djiri',
  'Université Marien Ngouabi', 'ENSP', 'ENSAF', 'ISG', 'ENS', 'ENAM', 'FST', 'lycée', 'BTS', 'BEPC', 'baccalauréat', 'licence', 'master', 'DUT', 'OHADA',
  'MTN', 'Airtel', 'SNPC', 'Total', 'E²C', 'stage', 'stagiaire', 'Lingala', 'Kituba', 'salacv', 'crédits', 'filigrane', 'MoMo',
];
export function liveSetup(state, { config = { model: DEFAULT_MODEL, voice: 'Kore' }, loggedIn = false, skills, history, versions } = {}) {
  return {
    model: `models/${config.model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      temperature: 0.8,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } },
    },
    systemInstruction: { parts: [{ text: liveInstruction(state, { loggedIn, history, versions, ...(skills ? { skills } : {}) }) }] },
    tools: [{ functionDeclarations: functionDeclarations() }],
    inputAudioTranscription: { languageCodes: ['fr-FR'], customVocabulary: VOCABULARY },
    outputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        prefixPaddingMs: 200,
        silenceDurationMs: 900,
      },
    },
    contextWindowCompression: { slidingWindow: {} },
  };
}

// --- Rotation des clés ------------------------------------------------------------------------------

const score = (who, entry) => createHash('sha256').update(`${who}|${entry.id ?? createHash('sha256').update(entry.key).digest('hex')}`).digest('hex');

/**
 * Ordre d'essai des clés pour UNE nouvelle session.
 *   entries : clés Gemini utilisables ; load : Map(id → { active, last }) des sessions en cours.
 *   1. ses N clés réservées (hachage stable : les mêmes à chaque fois), la moins chargée d'abord (à égalité : la moins
 *      récemment utilisée) ; 2. puis les autres clés du pool, même règle. Une clé pleine (maxSessionsPerKey) est sautée.
 * → { order, full } (full : des clés existent mais toutes sont pleines)
 */
export function orderKeys(entries, who, load, { keysPerUser = 2, maxSessionsPerKey = 3 } = {}) {
  const ranked = entries.map((e) => ({ e, s: score(who, e) })).sort((a, b) => (a.s < b.s ? -1 : 1)).map((x) => x.e);
  const info = (e) => load.get(e.id) ?? { active: 0, last: 0 };
  const byLoad = (list) =>
    list.filter((e) => info(e).active < maxSessionsPerKey).sort((a, b) => info(a).active - info(b).active || info(a).last - info(b).last);
  const order = [...byLoad(ranked.slice(0, keysPerUser)), ...byLoad(ranked.slice(keysPerUser))];
  return { order, full: entries.length > 0 && order.length === 0 };
}

/** Sessions en cours par clé (et dernier démarrage), pour la rotation. */
export async function liveLoad() {
  const rows = await query(
    `SELECT key_id, COUNT(*) FILTER (WHERE ended_at IS NULL AND expires_at > now())::int AS active, EXTRACT(EPOCH FROM MAX(started_at))::bigint AS last
     FROM live_sessions WHERE started_at > now() - interval '1 day' AND key_id IS NOT NULL GROUP BY key_id`,
  ).catch(() => []);
  return new Map(rows.map((r) => [Number(r.key_id), { active: Number(r.active), last: Number(r.last) }]));
}

// --- Jeton éphémère ---------------------------------------------------------------------------------

export class LiveError extends Error {
  constructor(message, { status = 503, userMessage } = {}) {
    super(message);
    this.status = status;
    this.userMessage = userMessage;
  }
}

const isRateLimit = (status, detail) => status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(detail);
const isBadKey = (status, detail) => status === 401 || /API_KEY_INVALID|API key not valid|PERMISSION_DENIED.*key/i.test(detail);

/**
 * Essaie les clés dans l'ordre donné → { token, expiresAt, keyId }. keySource : voir server/keys/pool.js.
 * order absent : les clés Gemini du pool dans leur ordre (tests, secours).
 */
export async function mintToken(setup, keySource, { order, full = false, minutes = 15, now = Date.now(), fetchImpl = fetch } = {}) {
  const queue = order ?? keySource?.candidates((p) => p.name === 'gemini') ?? [];
  for (const entry of queue) {
    const body = {
      uses: 1,
      expireTime: new Date(now + minutes * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
      bidiGenerateContentSetup: setup,
    };
    let res;
    try {
      res = await fetchImpl(`${API}/auth_tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': entry.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new LiveError(`gemini injoignable (${err.name})`, { userMessage: 'Gemini est injoignable. Vérifie ta connexion et réessaie.' });
    }
    const detail = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 600);
    if (res.ok) {
      const json = await res.json();
      if (!json?.name) throw new LiveError('réponse sans jeton');
      keySource?.used?.(entry, 0);
      return { token: json.name, expiresAt: Date.parse(body.expireTime), keyId: entry.id ?? null };
    }
    if (isRateLimit(res.status, detail)) {
      await keySource?.exhaust?.(entry);
      continue;
    }
    if (isBadKey(res.status, detail)) {
      await keySource?.invalid?.(entry);
      continue;
    }
    throw new LiveError(`auth_tokens ${res.status} : ${detail}`, { userMessage: 'Le direct n’a pas pu démarrer. Réessaie dans un instant.' });
  }
  if (full) throw new LiveError('toutes les clés gemini sont pleines', { status: 503, userMessage: 'Le direct est très demandé en ce moment. Réessaie dans une minute.' });
  throw new LiveError('aucune clé gemini disponible', { userMessage: 'Le direct est indisponible pour le moment (aucune clé Gemini disponible). Réessaie plus tard.' });
}

// --- Sessions (rotation, suivi dans l'admin) ---------------------------------------------------------

export async function openSession({ who, keyId, expiresAt }) {
  const id = randomBytes(9).toString('base64url');
  await query('INSERT INTO live_sessions (id, who, key_id, expires_at) VALUES ($1, $2, $3, $4)', [id, who, keyId, new Date(expiresAt)]).catch((err) => console.error(`[live] session non notée : ${err.message}`));
  return id;
}

export async function noteSession(id, { tokens = 0, end = false } = {}) {
  if (!id) return;
  await query(`UPDATE live_sessions SET tokens = tokens + $2${end ? ', ended_at = COALESCE(ended_at, now())' : ''} WHERE id = $1`, [id, Math.max(0, Math.round(tokens) || 0)]).catch(() => {});
}

/** Admin → Live : charge par clé (en cours, aujourd'hui, tokens) et dernières sessions. Jamais une clé en clair. */
export async function liveStats() {
  const perKey = await query(
    `SELECT key_id,
       COUNT(*) FILTER (WHERE ended_at IS NULL AND expires_at > now())::int AS active,
       COUNT(*) FILTER (WHERE started_at >= date_trunc('day', now()))::int AS today,
       COALESCE(SUM(tokens) FILTER (WHERE started_at >= date_trunc('day', now())), 0)::bigint AS tokens_today,
       MAX(started_at) AS last
     FROM live_sessions WHERE started_at > now() - interval '30 days' GROUP BY key_id`,
  ).catch(() => []);
  const recent = await query(
    `SELECT id, who, key_id, started_at, expires_at, ended_at, tokens FROM live_sessions ORDER BY started_at DESC LIMIT 30`,
  ).catch(() => []);
  return {
    perKey: perKey.map((r) => ({ keyId: r.key_id == null ? null : Number(r.key_id), active: r.active, today: r.today, tokensToday: Number(r.tokens_today), last: r.last ? new Date(r.last).getTime() : null })),
    recent: recent.map((r) => ({
      id: r.id,
      who: r.who,
      keyId: r.key_id == null ? null : Number(r.key_id),
      startedAt: new Date(r.started_at).getTime(),
      endedAt: r.ended_at ? new Date(r.ended_at).getTime() : null,
      expiresAt: new Date(r.expires_at).getTime(),
      tokens: Number(r.tokens),
    })),
  };
}

// --- Ticket de session (appels d'outils, compte rendu des tokens) -------------------------------------

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (env, body) => createHmac('sha256', signingSecret(env) ?? 'dev-live').update(`live:${body}`).digest('base64url');

export function issueTicket({ who, username, sid = null }, expiresAt, env = process.env) {
  const body = b64(JSON.stringify({ w: who, u: username ?? null, s: sid, exp: Math.floor(expiresAt / 1000) }));
  return `${body}.${sign(env, body)}`;
}

/** → { who, username, sid } si le ticket est valide et pas expiré (marge d'une minute pour le dernier compte rendu) ; sinon null. */
export function openTicket(ticket, env = process.env, now = Date.now()) {
  const [body, sig] = String(ticket ?? '').split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(env, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return t.exp + 60 > now / 1000 ? { who: t.w, username: t.u, sid: t.s ?? null } : null;
  } catch {
    return null;
  }
}

// --- Exécution d'un outil -----------------------------------------------------------------------------

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function creditsInfo(username, env) {
  const loggedIn = Boolean(username);
  const balance = loggedIn ? await credits.balance(username).catch(() => 0) : 0;
  const packs = (await listPacks().catch(() => []))
    .filter((p) => p.active)
    .sort((a, b) => a.credits - b.credits)
    .map((p) => ({ credits: p.credits, prix: effectivePrice(p), ...(effectivePrice(p) < p.price ? { prixNormal: p.price } : {}), prixParCredit: Math.round(effectivePrice(p) / p.credits) }));
  const cfg = await lightpayConfig(env).catch(() => ({ ready: false }));
  const shopOpen = loggedIn && !String(username).startsWith('key:') && canBuy(cfg, username);
  return {
    connecte: loggedIn,
    solde: balance,
    coutCvPropre: credits.PDF_COST,
    devise: 'FCFA',
    packs,
    rechargePossible: shopOpen,
    note: !loggedIn
      ? 'Visiteur : il doit se connecter pour un CV propre et pour recharger.'
      : balance >= credits.PDF_COST
        ? 'Il a assez de crédits pour un CV propre.'
        : shopOpen
          ? 'Pas assez de crédits : propose-lui de recharger (open_shop s’il dit oui).'
          : 'Pas assez de crédits et la recharge est momentanément fermée : le PDF sortira avec filigrane.',
  };
}

async function creditHistory(username) {
  if (!username) return { connecte: false, note: 'Visiteur : pas d’historique (il faut un compte).' };
  const list = await credits.history(username, 12).catch(() => []);
  return {
    connecte: true,
    solde: list[0]?.balance ?? (await credits.balance(username).catch(() => 0)),
    mouvements: list.map((m) => ({ date: day(m.at), crédits: m.delta, raison: m.reason, soldeApres: m.balance })),
  };
}

/**
 * Exécute UN appel d'outil de Gemini.
 *   Écriture (LIVE_TOOLS) : sur le CV envoyé par le studio, sous les garde-fous. said : ce que l'étudiant a dit (transcription).
 *   Lecture (INFO_TOOLS) : crédits, historique, préparation de la génération (context.versions).
 * → { ok, result, state?, changes?, pending?, generate? }
 */
export async function runLiveTool({ state, name, args, said, context }, { username = null, env = process.env } = {}) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (name === 'credits_info') return { ok: true, result: await creditsInfo(username, env) };
  if (name === 'credit_history') return { ok: true, result: await creditHistory(username) };
  if (name === 'generate_cv') {
    const run = { username, context: { versions: cleanStart({ context }).versions } };
    const result = await byName.get('generate_cv').run(run, input).catch((err) => ({ error: err.message }));
    // En direct, rien ne part tout seul : une carte apparaît et c'est lui qui la touche.
    if (run.generate) result.aDire = 'Une carte « Générer mon CV » vient d’apparaître à l’écran : dis-lui de la toucher. Rien n’est encore en cours ni téléchargé.';
    return { ok: true, result, ...(run.generate ? { generate: run.generate } : {}) };
  }
  if (!LIVE_TOOLS.includes(name) || !WRITE_TOOLS.has(name)) return { ok: false, status: 400, error: 'Outil inconnu.' };
  const tool = byName.get(name);
  const heard = String(said ?? '').slice(-4000);
  const run = { state: normalize(state), changes: new Set(), flags: {}, username, context: {}, memory: [] };
  run.userText = heard;
  run.sources = [heard, run.state.profile.email, ...run.state.profile.phones].join('\n');
  let result;
  try {
    result = await guardedRun(run, tool, name, input);
  } catch (err) {
    result = { error: `Échec de ${name} : ${err.message}` };
  }
  const pending = sealPending(run, env);
  return { ok: true, result: result ?? {}, state: compact(run.state), changes: [...run.changes].sort(), ...(pending ? { pending } : {}) };
}
