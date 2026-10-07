// Garde-fous de l'agent, côté serveur (le modèle ne peut pas les contourner) :
//   • ajouter, remplir un champ vide : libre (et annulable dans le chat) ;
//   • écraser une valeur déjà écrite : seulement si la demande en cours le demande (« corrige », « reformule »…),
//     sinon le changement attend la confirmation de l'utilisateur ;
//   • supprimer (un bloc, une compétence, une langue, un numéro…) : toujours la confirmation de l'utilisateur ;
//   • coordonnées (e-mail, téléphone) : jamais inventées, elles doivent venir de l'utilisateur ;
//   • dépenser (générer un PDF) : jamais l'agent, toujours un bouton touché par l'utilisateur (voir le studio).
// Un changement en attente part au navigateur signé ; il ne s'applique que si l'utilisateur touche « Confirmer »,
// sur le CV tel qu'il était (empreinte), sans nouvel appel au modèle.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { compact, normalize } from './state.js';
import { signingSecret } from './auth.js';

export const WRITE_TOOLS = new Set(['set_identity', 'set_summary', 'add_entry', 'update_entry', 'remove_entry', 'edit_list', 'set_languages']);

// La demande dit clairement de changer ce qui existe.
const INTENT = /\b(modifi|chang|corrig|remplac|reformul|amélior|amelior|réécri|reecri|rectifi|mets?\b|mettre|met\b|actualis|mise? à jour|update|fix|renomm|traduis|raccourci|allonge|complète|complete|réorganis)/i;
export const explicitChange = (message) => INTENT.test(String(message ?? ''));

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const lines = (s) => String(s ?? '').split('\n').filter(Boolean);
const filled = (o) => Object.values(o).some(Boolean);

/** Ce qu'un changement fait au CV : { removed, overwritten } */
export function impact(before, after) {
  let removed = false;
  let overwritten = false;
  const p0 = before.profile;
  const p1 = after.profile;
  for (const k of ['name', 'title', 'email', 'address', 'link', 'summary']) {
    if (!p0[k] || p0[k] === p1[k]) continue;
    if (!p1[k]) removed = true;
    else overwritten = true;
  }
  if (p0.phones.some((ph) => !p1.phones.some((x) => digits(x) === digits(ph)))) removed = true;
  for (const key of ['education', 'experiences']) {
    const a = before[key].filter(filled);
    const b = after[key].filter(filled);
    if (b.length < a.length) removed = true;
    a.forEach((it, i) => {
      const nx = b[i];
      if (!nx) return;
      for (const k of ['title', 'org', 'period']) if (it[k] && it[k] !== nx[k]) (nx[k] ? (overwritten = true) : (removed = true));
      if (lines(it.details).some((d) => !lines(nx.details).includes(d))) overwritten = true;
    });
  }
  for (const key of ['skills', 'hobbies']) if (before[key].some((v) => !after[key].some((x) => fold(x) === fold(v)))) removed = true;
  const langs = (s) => s.languages.filter((l) => l.name);
  for (const l of langs(before)) {
    const m = langs(after).find((x) => fold(x.name) === fold(l.name));
    if (!m) removed = true;
    else if (l.level && m.level !== l.level) overwritten = true;
  }
  return { removed, overwritten };
}

/** Coordonnées ajoutées ou changées qui ne viennent pas de l'utilisateur. → [« e-mail », « téléphone »] */
export function inventedContacts(before, after, sources) {
  const src = fold(sources);
  const srcDigits = digits(sources);
  const out = [];
  const email = after.profile.email;
  if (email && email !== before.profile.email && !src.includes(fold(email))) out.push('e-mail');
  for (const ph of after.profile.phones) {
    if (before.profile.phones.some((x) => digits(x) === digits(ph))) continue;
    const d = digits(ph).slice(-8);
    if (d.length < 6 || !srcDigits.includes(d)) out.push('téléphone');
  }
  return [...new Set(out)];
}

/** Une phrase lisible par l'utilisateur pour un changement en attente. */
export function describe(name, args, state) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : '');
  const sec = (s) => (s === 'education' ? 'la formation' : 'l’expérience');
  const entry = (s, i) => state[s]?.[i]?.title || `n° ${Number(i) + 1}`;
  switch (name) {
    case 'remove_entry':
      return `Supprimer ${sec(args.section)} « ${entry(args.section, args.index)} »`;
    case 'update_entry':
      return `Modifier ${sec(args.section)} « ${entry(args.section, args.index)} »`;
    case 'set_summary':
      return 'Remplacer ton profil professionnel';
    case 'set_identity': {
      const LABEL = { name: 'le nom', title: 'le métier', email: 'l’e-mail', address: 'l’adresse', link: 'le lien', phones: 'les téléphones' };
      const keys = Object.keys(LABEL).filter((k) => args[k] != null);
      return `Changer ${keys.map((k) => LABEL[k]).join(', ')}`;
    }
    case 'edit_list': {
      const what = args.section === 'hobbies' ? 'loisirs' : 'compétences';
      if (args.mode === 'replace') return `Remplacer toutes tes ${what} par : ${list(args.items)}`;
      return `Retirer des ${what} : ${list(args.items)}`;
    }
    case 'set_languages':
      return args.mode === 'replace' ? `Remplacer toutes tes langues par : ${list((args.languages ?? []).map((l) => l?.name))}` : 'Changer le niveau de tes langues';
    default:
      return 'Modifier ton CV';
  }
}

/**
 * Exécute un outil qui modifie le CV, sous garde. run : { state, changes, userText, sources, pending }.
 * → résultat de l'outil, ou { pending: true, info } (rien n'est appliqué), ou { error }.
 */
export async function guardedRun(run, tool, name, args) {
  const before = normalize(run.state);
  const trial = { ...run, state: structuredClone(run.state), changes: new Set() };
  const result = await tool.run(trial, args);
  if (result?.error) return result;
  const after = normalize(trial.state);
  const invented = inventedContacts(before, after, run.sources ?? '');
  if (invented.length) {
    return { error: `Refusé : ${invented.join(' et ')} absent de ce que l'utilisateur a donné. N'invente jamais de coordonnées : demande-les-lui.` };
  }
  const { removed, overwritten } = impact(before, after);
  if (removed || (overwritten && !explicitChange(run.userText))) {
    run.pending ??= [];
    if (run.pending.length >= 10) return { error: 'Trop de changements en attente : demande d’abord à l’utilisateur de confirmer.' };
    run.pending.push({ tool: name, args, line: describe(name, args, run.state) });
    return {
      pending: true,
      info: "EN ATTENTE : ce changement retire ou remplace ce que l'utilisateur a écrit. Il ne s'applique que s'il touche « Confirmer ». Ne dis pas que c'est fait : dis ce que tu proposes et qu'il peut confirmer.",
    };
  }
  run.state = trial.state;
  for (const c of trial.changes) run.changes.add(c);
  return result;
}

// --- Changement en attente : signé, lié au CV tel qu'il était -------------------------------------------
const fallback = randomBytes(32); // développement et tests sans clé : valable le temps du processus
const key = (env) => signingSecret(env) ?? fallback;
export const fingerprint = (state) => createHash('sha256').update(JSON.stringify(compact(normalize(state)))).digest('base64url').slice(0, 32);
const signBody = (env, who, ops, base) => createHmac('sha256', key(env)).update(JSON.stringify([who ?? 'visiteur', ops, base])).digest('base64url');

export function sealPending(run, env) {
  if (!run.pending?.length) return null;
  const ops = run.pending.map(({ tool, args }) => ({ tool, args }));
  const base = fingerprint(run.state);
  return { ops, lines: run.pending.map((p) => p.line), base, sig: signBody(env, run.username, ops, base) };
}

/** → { ok, ops } si la signature et l'empreinte du CV correspondent. */
export function openPending(pending, state, who, env) {
  if (!pending || !Array.isArray(pending.ops) || !pending.ops.length || pending.ops.length > 10) return { ok: false, error: 'Rien à confirmer.' };
  if (pending.ops.some((op) => !WRITE_TOOLS.has(op?.tool))) return { ok: false, error: 'Changement refusé.' };
  const expected = Buffer.from(signBody(env, who, pending.ops, pending.base));
  const got = Buffer.from(String(pending.sig ?? ''));
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, error: 'Changement refusé.' };
  if (fingerprint(state) !== pending.base) return { ok: false, error: 'Ton CV a changé depuis : redemande à l’assistant.' };
  return { ok: true, ops: pending.ops };
}
