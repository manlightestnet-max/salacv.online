// Génération du CV (PDF, Word) CÔTÉ SERVEUR : c'est le serveur qui décide si le PDF sort propre ou avec filigrane,
// et qui débite le crédit. Un visiteur ne peut donc pas retirer le filigrane en modifiant la page.
//
//   visiteur non connecté, ou compte sans crédit → PDF avec filigrane, Word bloqué, rien n'est débité
//   compte avec un crédit (ou version déjà générée) → PDF propre + Word, 1 crédit débité une seule fois par version
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { layoutResume, loadFontSet } from '../src/index.js';
import { renderPdf } from '../src/render/pdf.js';
import { renderDocx } from '../src/render/docx.js';
import { registerTemplate } from '../src/templates/index.js';
import { templateFromSpec } from '../src/templates/spec.js';
import { normalizeState, toResume } from '../app/state.js';
import { verify } from './agent/auth.js';
import { RateLimiter } from './ratelimit.js';
import { query } from './db/index.js';
import { getUser } from './db/users.js';
import { store } from './store.js';
import * as credits from './credits.js';
import { r2Configured, r2Put, userPrefix } from './r2.js';

export const PDF_COST = 1;
export const WATERMARK = 'salacv.online · version gratuite';
export const MAX_RENDER_BODY = 1024 * 1024; // l'état du CV, photo comprise

const renderLimiter = new RateLimiter(10);
const FONT_DIR = path.resolve(import.meta.dirname, '../fonts');
let fonts = null;
const getFonts = () => (fonts ??= loadFontSet((file) => readFile(path.join(FONT_DIR, file))));

// Modèles téléversés par l'admin : enregistrés (une fois par version) avant de dessiner.
let registered = '';
async function registerSpecs() {
  const specs = await store().get('templateSpecs', []);
  const sig = JSON.stringify(specs);
  if (sig === registered) return;
  for (const spec of specs) registerTemplate(templateFromSpec(spec));
  registered = sig;
}

const fingerprintOf = (resume) => createHash('sha256').update(JSON.stringify(resume)).digest('hex').slice(0, 32);
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// → [statut, corps]
export async function render(payload, token, { env = process.env, ctx } = {}) {
  const username = token ? verify(token, env) : null;
  if (token && !username) return [401, { ok: false, error: 'Ta session a expiré. Reconnecte-toi.' }];
  if (!username && !ctx) return [400, { ok: false, error: 'Requête invalide.' }];
  const who = username ?? `ip:${ctx.ip}`;
  if (!renderLimiter.allow(who)) return [429, { ok: false, error: 'Trop de demandes. Attends une minute.' }];
  if (username && (await getUser(username).catch(() => null))?.blocked) return [403, { ok: false, error: 'Ce compte est suspendu.' }];

  if (!payload?.state || typeof payload.state !== 'object') return [400, { ok: false, error: 'CV manquant.' }];
  const wanted = Array.isArray(payload.formats) ? payload.formats.filter((f) => f === 'pdf' || f === 'docx') : ['pdf'];
  const formats = wanted.length ? [...new Set(wanted)] : ['pdf'];

  const resume = toResume(normalizeState(payload.state));
  if (!resume.profile.name) return [400, { ok: false, error: 'Ton nom manque.' }];
  const fingerprint = fingerprintOf(resume);

  // --- Droits ------------------------------------------------------------------------------------
  let clean = false;
  let charged = false;
  let balance = null;
  let already = false; // version déjà générée proprement : gratuite
  if (username) {
    balance = await credits.ensureAccount(username, env);
    already = await credits.hasRendered(username, fingerprint);
    if (already) clean = true;
    else if (payload.dryRun) clean = balance >= PDF_COST;
    else if (await credits.markRendered(username, fingerprint)) {
      const spent = await credits.spend(username, PDF_COST, `CV ${resume.profile.name}`, `render:${username}:${fingerprint}`);
      balance = spent.balance;
      if (spent.ok) clean = charged = true;
      else await credits.unmarkRendered(username, fingerprint); // plus de crédit : pas de trace, PDF avec filigrane
    } else clean = true;
  }
  const entitlement = clean ? 'clean' : 'watermark';
  const reason = clean ? null : username ? 'Tu n’as plus de crédit : ton PDF sort avec filigrane.' : 'Connecte-toi pour un PDF sans filigrane et la version Word.';
  if (payload.dryRun) return [200, { ok: true, dryRun: true, loggedIn: Boolean(username), entitlement, cost: clean && !already ? PDF_COST : 0, balance, reason, wordAllowed: clean }];

  // --- Rendu --------------------------------------------------------------------------------------
  await registerSpecs();
  const f = await getFonts();
  const laid = layoutResume(resume, f, { watermark: clean ? undefined : WATERMARK });
  if (!laid.ok) return [400, { ok: false, error: 'La mise en page a échoué : vérifie ton CV.' }];

  const files = {};
  const blocked = {};
  const name = resume.profile.name;
  if (formats.includes('pdf')) files.pdf = { watermarked: !clean, base64: b64(await renderPdf(laid.doc, f, { title: `CV — ${name}`, author: name })) };
  if (formats.includes('docx')) {
    if (clean) files.docx = { watermarked: false, base64: b64(await renderDocx(laid.resume)) };
    else blocked.docx = username ? 'Le Word est réservé aux CV débloqués avec un crédit.' : 'Le Word est réservé aux comptes connectés.';
  }
  await query('INSERT INTO render_log (clean) VALUES ($1)', [clean]).catch(() => {});
  // PDF d'un client (propre, donc payé) : gardé sur R2 si configuré ; un échec n'empêche jamais le téléchargement.
  if (clean && username && files.pdf && (await r2Configured(env).catch(() => false))) {
    r2Put(`${userPrefix(username)}/pdf/${fingerprint}.pdf`, Buffer.from(files.pdf.base64, 'base64'), 'application/pdf', { env }).catch((err) => console.error(`[r2] PDF non gardé : ${err.message}`));
  }
  return [200, { ok: true, entitlement, charged, balance, loggedIn: Boolean(username), reason, files, blocked }];
}

// Solde et registre du compte connecté (visiteur : zéro).
export async function creditsRoute(token, { env = process.env } = {}) {
  const username = token ? verify(token, env) : null;
  if (!username) return [200, { ok: true, loggedIn: false, balance: 0, history: [] }];
  const balance = await credits.ensureAccount(username, env);
  return [200, { ok: true, loggedIn: true, balance, history: await credits.history(username) }];
}
