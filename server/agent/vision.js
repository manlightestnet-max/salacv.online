// Image jointe à l'assistant (ancien CV, diplôme, attestation, capture d'un profil…) : lue UNE fois par un modèle qui
// voit les images, et transformée en texte. Ce texte rejoint le message de l'utilisateur ; la boucle de l'agent ne
// renvoie jamais l'image (sinon chaque étape la repaierait). L'image n'est ni gardée ni journalisée.
import { callLLM } from './llm/client.js';

// Le navigateur la réduit avant l'envoi (1600 px, JPEG) : ~300 Ko en général. Au-delà de cette taille, refus.
export const MAX_IMAGE_CHARS = 1_600_000;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function checkImage(image) {
  if (image == null || image === '') return { ok: true, image: null };
  const s = String(image);
  if (s.length > MAX_IMAGE_CHARS) return { ok: false, error: 'Image trop lourde. Envoie une photo plus petite ou une capture.' };
  if (!DATA_URL.test(s)) return { ok: false, error: 'Format d’image non pris en charge (PNG, JPEG ou WebP).' };
  return { ok: true, image: s };
}

const READ_PROMPT = `Tu lis une image envoyée par un utilisateur de salacv, une app qui fait des CV.
Recopie en texte, fidèlement, tout ce qui peut servir à un CV : nom, titre ou métier, téléphone, e-mail, adresse,
formation (diplôme, école, années), expériences (poste, entreprise, période, missions), compétences, langues et niveaux,
certifications, centres d'intérêt. Garde l'orthographe exacte des noms, des écoles, des entreprises et des dates.
N'invente rien et ne complète pas : écris « illisible » pour ce que tu ne peux pas lire.
Réponds en français, en liste courte par rubrique. Si l'image n'a rien à voir avec un CV, dis-le en une phrase.`;

/** → texte lu dans l'image. Seuls les fournisseurs qui voient les images sont utilisés. */
export async function readImage(image, { env = process.env, keySource = null, timeoutMs = 60_000, callModel } = {}) {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: READ_PROMPT },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
  const json = callModel ? await callModel(messages) : await callLLM(messages, [], { temperature: 0.1, timeoutMs, env, keySource, vision: true });
  return String(json?.choices?.[0]?.message?.content ?? '').trim();
}

// Ce que l'agent reçoit : la demande de l'utilisateur, puis le contenu de l'image, et la consigne de demander le reste.
export function withImageText(message, text) {
  const ask = message || 'Remplis mon CV avec les informations de cette image.';
  return `${ask}

[Image jointe par l'utilisateur, lue par salacv :]
${text}
[Fin de l'image]
Remplis le CV avec ce qui est sûr dans cette image (sans rien inventer), puis dis en une phrase ce que tu as rempli.
Pour ce qui manque ou n'est pas lisible et qui compte pour un bon CV, pose-moi des questions courtes (3 au plus).`;
}
