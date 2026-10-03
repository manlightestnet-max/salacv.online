// DSL des modèles : un modèle de CV décrit en JSON (aucun code), que n'importe qui peut
// écrire et que l'admin téléverse. Le moteur (congo.js) le dessine en PDF, Skia et Word.
// Référence : docs/modeles-dsl.md.
import { z } from 'zod';
import { fromSpec } from './congo.js';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'couleur au format #RRGGBB');

export const templateSpec = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'minuscules, chiffres et tirets (2 à 40)'),
    name: z.string().trim().min(1).max(40),
    // En-tête : left (nom à gauche, photo à droite), center (tout centré, sans photo),
    // banner (« CURRICULUM VITAE » encadré + état civil), pill (titre noir arrondi),
    // title (titre en couleur d'accent souligné + état civil).
    header: z.enum(['left', 'center', 'banner', 'pill', 'title']).default('left'),
    // Titres de section : bar (bandeau + ◆), band (bandeau centré), box (cadre arrondi),
    // underline (souligné), dot (pastille et soulignement en couleur d'accent).
    heading: z.enum(['bar', 'band', 'box', 'underline', 'dot']).default('underline'),
    bullet: z.enum(['check', 'dot', 'arrow', 'dash']).default('dot'),
    paper: z.enum(['plain', 'lined']).default('plain'),
    colors: z.object({ ink: color.optional(), accent: color.optional(), band: color.optional() }).strict().default({}),
    sizes: z
      .object({ name: z.number().min(12).max(30).optional(), body: z.number().min(7.5).max(12).optional(), heading: z.number().min(8).max(16).optional() })
      .strict()
      .default({}),
  })
  .strict();

// → { ok: true, spec } ou { ok: false, error } (message lisible pour l'admin).
export function parseTemplateSpec(raw) {
  const r = templateSpec.safeParse(raw);
  if (r.success) return { ok: true, spec: r.data };
  const i = r.error.issues[0];
  return { ok: false, error: `${i.path.join('.') || 'modèle'} : ${i.message}` };
}

export const templateFromSpec = (spec) => fromSpec(templateSpec.parse(spec));
