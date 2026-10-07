import { params } from './base.js';
import { TEMPLATES } from '../../../app/state.js';
import { store } from '../../store.js';

// Ce que montre chaque modèle (d'après le code des modèles) : l'agent choisit sur cette base, jamais au hasard.
export const TEMPLATE_INFO = {
  minimal: 'une colonne, net et lisible',
  bandeau: 'bandeau de couleur et colonne latérale',
  vitae: 'classique, intitulés alignés à gauche',
  diagonale: 'en-tête en diagonale, moderne',
  epure: 'beaucoup de blanc, très calme',
  marine: 'colonne bleu marine avec photo ronde',
  contraste: 'nom en capitales, bandeau noir',
  classique: 'CV congolais : en-tête à gauche, photo à droite, titres sur bandeau gris',
  cursus: 'CV congolais : « CURRICULUM VITAE » encadré, état civil en tableau',
  encadre: 'CV congolais : titres dans des cadres arrondis',
  sobre: 'CV congolais : nom centré, titres soulignés',
  cahier: 'CV congolais : feuille de cahier lignée, marge rouge',
};

// Propose des modèles à l'utilisateur : des cartes avec SON CV dans chaque modèle s'affichent dans le chat, il touche
// celui qu'il veut. L'agent ne change jamais le modèle lui-même ; rien n'est dépensé.
export default {
  name: 'propose_templates',
  description:
    'Propose 2 ou 3 modèles adaptés à son profil (métier, secteur, photo ou non), quand son CV est rempli (nom + une formation ou une expérience) ' +
    'et qu’il n’a pas encore choisi, ou quand il demande un modèle. Il choisit dans le chat ; tu ne changes pas le modèle toi-même. ' +
    `Modèles : ${TEMPLATES.map((t) => `${t.id} (${TEMPLATE_INFO[t.id] ?? t.name})`).join(' ; ')}.`,
  parameters: params(
    {
      templates: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string', description: 'Pourquoi, en quelques mots' } }, required: ['id'] },
        description: '2 ou 3 modèles, le plus adapté en premier',
      },
    },
    ['templates'],
  ),
  async run(run, { templates } = {}) {
    // Seulement les modèles disponibles (l'admin peut en retirer).
    const settings = (await store().get('templates', {}).catch(() => ({}))) ?? {};
    const available = (id) => TEMPLATES.some((t) => t.id === id) && settings[id]?.enabled !== false;
    const picked = [];
    for (const t of Array.isArray(templates) ? templates : []) {
      const id = String(t?.id ?? '');
      if (!available(id) || picked.some((p) => p.id === id)) continue;
      picked.push({ id, name: TEMPLATES.find((x) => x.id === id).name, reason: String(t?.reason ?? '').trim().slice(0, 90) });
      if (picked.length === 3) break;
    }
    if (!picked.length) return { error: 'Aucun de ces modèles n’est disponible : choisis parmi la liste.' };
    run.templates = picked;
    return { ok: true, shown: picked.map((p) => p.name), info: 'Les cartes sont affichées : invite-le à toucher celui qu’il préfère.' };
  },
};
