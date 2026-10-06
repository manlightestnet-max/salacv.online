import { params } from './base.js';
import * as credits from '../../credits.js';

// Préparer le PDF à la demande de l'utilisateur. L'agent ne fabrique jamais le fichier lui-même : il vérifie les crédits,
// puis le studio ouvre la préparation habituelle, où le SERVEUR revérifie et débite (/api/render). Aucun contournement possible.
export default {
  name: 'generate_cv',
  description:
    "Prépare le téléchargement du CV (PDF), SEULEMENT si l'utilisateur le demande explicitement. Vérifie d'abord ses crédits. " +
    "S'il existe plusieurs versions (langues, CV du projet) et qu'il n'a pas dit laquelle, n'appelle pas cet outil : demande-lui laquelle. " +
    'Ne modifie pas le CV.',
  parameters: params({ version: { type: 'string', description: 'Clé de la version à générer (voir VERSIONS), obligatoire s’il y en a plusieurs' } }),
  async run(run, { version } = {}) {
    const versions = run.context?.versions ?? [];
    let chosen = versions.find((v) => v.key === version);
    if (!chosen && versions.length === 1) chosen = versions[0];
    if (!chosen) {
      return versions.length
        ? { error: `Plusieurs versions : demande à l'utilisateur laquelle générer (${versions.map((v) => `${v.key} = ${v.label}`).join(' ; ')}).` }
        : { error: 'Aucune version à générer.' };
    }
    const cost = credits.PDF_COST;
    const balance = run.username ? await credits.balance(run.username).catch(() => 0) : 0;
    const enough = Boolean(run.username) && balance >= cost;
    run.generate = { version: chosen.key, label: chosen.label, loggedIn: Boolean(run.username), balance, cost, enough };
    return {
      ok: true,
      version: chosen.label,
      loggedIn: Boolean(run.username),
      balance,
      cost,
      enough,
      note: enough
        ? 'La préparation va s’ouvrir chez l’utilisateur ; le crédit est débité au téléchargement (gratuit si cette version a déjà été payée).'
        : run.username
          ? 'Crédits insuffisants : le PDF sortira avec filigrane. Invite-le à recharger ses crédits (Mes crédits) pour un PDF propre et le Word.'
          : 'Visiteur : le PDF sortira avec filigrane. Invite-le à se connecter puis à recharger ses crédits pour un PDF propre.',
    };
  },
};
