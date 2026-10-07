// Registre des outils. Un nouvel outil = un fichier dans ce dossier + une ligne ici
// (import statique : Vercel n'embarque que les fichiers importés).
import addEntry from './add-entry.js';
import editList from './edit-list.js';
import finalAnswer from './final-answer.js';
import loadSkill from './load-skill.js';
import removeEntry from './remove-entry.js';
import setIdentity from './set-identity.js';
import setLanguages from './set-languages.js';
import setSummary from './set-summary.js';
import updateEntry from './update-entry.js';
import listPersonas from './list-personas.js';
import generateCv from './generate-cv.js';
import proposeTemplates from './propose-templates.js';
import { forgetTool, rememberTool } from './remember.js';
import { spec } from './base.js';

export const TOOLS = [finalAnswer, setIdentity, setSummary, addEntry, updateEntry, removeEntry, editList, setLanguages, loadSkill, listPersonas, generateCv, proposeTemplates, rememberTool, forgetTool];

export const specs = () => TOOLS.map(spec);
export const byName = new Map(TOOLS.map((t) => [t.name, t]));
