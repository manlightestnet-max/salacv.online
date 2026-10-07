// Import d'un CV existant (PDF ou photo) : UN appel à l'IA, qui renvoie le CV candidat en JSON ; puis les
// vérifications gratuites (contract.js, checks.js). Le fichier n'est ni gardé ni journalisé.
//
// Trois modes, choisis dans le navigateur selon le document (le moins cher qui marche) :
//   text  : PDF avec du texte, mise en page simple → le texte seul (le moins cher) ;
//   mixed : PDF avec du texte, mise en page en colonnes → images des pages (basse résolution) pour la structure
//           ET texte pour recopier les mots exacts (et prouver chaque valeur ensuite) ;
//   scan  : PDF scanné ou photo, sans texte → images plus nettes ; rien ne peut être prouvé, plus de champs à vérifier.
import { callLLM, LLMError } from '../agent/llm/client.js';
import { LEVELS } from '../agent/state.js';
import { checkImage } from '../agent/vision.js';
import { parseJson, toCandidate } from './contract.js';
import { review } from './checks.js';

export const MODES = ['text', 'mixed', 'scan'];
export const MAX_PAGES = 4;
const MAX_TEXT = 20_000; // par page
const MAX_IMAGES_CHARS = 3_600_000; // toutes pages confondues (la requête reste sous la limite de l'hébergeur)

const SHAPE = `{
  "profile": { "name": "", "title": "", "email": "", "phones": [""], "address": "", "link": "", "summary": "" },
  "education": [{ "title": "", "org": "", "period": "", "details": [""] }],
  "experiences": [{ "title": "", "org": "", "period": "", "details": [""] }],
  "skills": [""],
  "languages": [{ "name": "", "level": "" }],
  "hobbies": [""],
  "uncertain": ["chemin.du.champ"]
}`;

function prompt(mode) {
  const source =
    mode === 'text'
      ? 'Tu reçois le TEXTE d’un CV (PDF).'
      : mode === 'mixed'
        ? 'Tu reçois les IMAGES des pages d’un CV ET le TEXTE de ce PDF. Sers-toi des images pour comprendre la structure (colonnes, sections, quelle date va avec quel poste) et RECOPIE les mots depuis le texte, à l’identique.'
        : 'Tu reçois les IMAGES des pages d’un CV (scan ou photo).';
  return `${source}
Extrais-le en JSON, exactement dans cette forme (champ vide ou liste vide si absent) :
${SHAPE}
Règles :
- Recopie à l'identique noms, écoles, entreprises, dates, e-mails et numéros. N'invente rien, ne complète rien, ne traduis rien.
- education = diplômes, formations, certifications ; experiences = emplois, stages, bénévolat. details = une mission ou un acquis par élément.
- period comme écrit sur le CV (ex. « 2021 — 2024 », « Mars — Août 2024 »).
- languages.level parmi : ${LEVELS.join(', ')} (le plus proche de ce qui est écrit), sinon vide.
- uncertain : chemins des valeurs dont tu n'es pas sûr (ex. « profile.email », « experiences.1.period », « skills.3 »).
- Si ce n'est pas un CV, renvoie {"profile":{},"uncertain":[]} .
Réponds UNIQUEMENT avec le JSON.`;
}

/** Contrôle de la demande. → { ok, mode, pages } | { ok: false, error } */
export function checkImport(payload) {
  const mode = MODES.includes(payload?.mode) ? payload.mode : null;
  if (!mode) return { ok: false, error: 'Mode d’import inconnu.' };
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (!pages.length) return { ok: false, error: 'Document vide.' };
  if (pages.length > MAX_PAGES) return { ok: false, error: `${MAX_PAGES} pages au plus : garde les pages de ton CV.` };
  let imagesChars = 0;
  const out = [];
  for (const p of pages) {
    const text = String(p?.text ?? '').slice(0, MAX_TEXT);
    let image = null;
    if (p?.image) {
      const c = checkImage(p.image);
      if (!c.ok) return { ok: false, error: c.error };
      image = c.image;
      imagesChars += image.length;
    }
    out.push({ text, image });
  }
  if (imagesChars > MAX_IMAGES_CHARS) return { ok: false, error: 'Document trop lourd. Essaie avec moins de pages.' };
  if (mode === 'text' && !out.some((p) => p.text.trim().length > 40)) return { ok: false, error: 'Ce PDF ne contient pas de texte lisible.' };
  if (mode !== 'text' && !out.some((p) => p.image)) return { ok: false, error: 'Images des pages manquantes.' };
  return { ok: true, mode, pages: out };
}

function messagesFor(mode, pages) {
  const content = [{ type: 'text', text: prompt(mode) }];
  if (mode !== 'text') pages.forEach((p, i) => p.image && content.push({ type: 'text', text: `Page ${i + 1} :` }, { type: 'image_url', image_url: { url: p.image } }));
  if (mode !== 'scan') content.push({ type: 'text', text: `TEXTE DU PDF :\n${pages.map((p, i) => `--- page ${i + 1} ---\n${p.text}`).join('\n')}` });
  return [{ role: 'user', content: mode === 'text' ? content.map((c) => c.text).join('\n\n') : content }];
}

/**
 * Le handler de /api/import (via runAi : limite de débit, réserve d'IA, tokens comptés).
 * → { ok, candidate: { state, verify, issues, proven, counts }, mode, pages }
 */
export async function importCv(payload, { env = process.env, keySource = null, callModel, username = null } = {}) {
  if (!username) return { ok: false, status: 401, error: 'Connecte-toi avec Google pour importer ton CV (c’est gratuit) : il sera gardé sur ton compte.' };
  const req = checkImport(payload);
  if (!req.ok) return { ok: false, status: 400, error: req.error };
  const vision = req.mode !== 'text';
  const ask = (messages) => (callModel ? callModel(messages, { vision }) : callLLM(messages, [], { temperature: 0.1, timeoutMs: 55_000 /* sous la limite de 60 s de l'hébergeur */, env, keySource, vision }));
  const messages = messagesFor(req.mode, req.pages);
  let raw;
  try {
    raw = parseJson((await ask(messages))?.choices?.[0]?.message?.content);
    if (!raw) {
      // Une seule relance, courte : le modèle a répondu autre chose que du JSON.
      const again = await ask([...messages, { role: 'user', content: 'Réponds uniquement avec le JSON demandé, sans texte autour.' }]);
      raw = parseJson(again?.choices?.[0]?.message?.content);
    }
  } catch (err) {
    console.error(`[import] ${err.message}`);
    return { ok: false, status: 503, error: err instanceof LLMError && err.userMessage ? err.userMessage : 'La lecture du CV est momentanément indisponible. Réessaie dans un instant.' };
  }
  if (!raw) return { ok: false, status: 502, error: 'Je n’ai pas réussi à lire ce CV. Essaie un autre fichier, ou raconte ton parcours à l’assistant.' };
  const { state, aiUncertain } = toCandidate(raw);
  if (!state.profile.name && !state.education.length && !state.experiences.length) {
    return { ok: false, status: 422, error: 'Ce document ne ressemble pas à un CV. Essaie un autre fichier.' };
  }
  const sourceText = req.mode === 'scan' ? '' : req.pages.map((p) => p.text).join('\n');
  return { ok: true, mode: req.mode, pages: req.pages.length, candidate: review(state, { sourceText, aiUncertain }) };
}
