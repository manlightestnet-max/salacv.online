import { bandeau } from './bandeau.js';
import { cahier, classique, cursus, encadre, sobre } from './congo.js';
import { contraste } from './contraste.js';
import { diagonale } from './diagonale.js';
import { epure } from './epure.js';
import { marine } from './marine.js';
import { minimal } from './minimal.js';
import { vitae } from './vitae.js';

// Un template = { id, margin, build(resume, kit, page) → blocs, decorate?(doc, resume, kit) }.
// Pour en ajouter un : le fichier, une ligne ici, l'id dans l'enum du schéma (src/dsl/schema.js)
// et dans TEMPLATES (app/state.js).
export const templates = { minimal, bandeau, vitae, diagonale, epure, marine, contraste, classique, cursus, encadre, sobre, cahier };
