import { bandeau } from './bandeau.js';
import { minimal } from './minimal.js';

export const templates = { minimal, bandeau };

// Liste affichée dans le choix du modèle (app) : id + nom.
export const TEMPLATE_LIST = [
  { id: 'minimal', name: 'Minimal' },
  { id: 'bandeau', name: 'Bandeau' },
];
