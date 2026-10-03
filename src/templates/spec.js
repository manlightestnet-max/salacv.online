// DSL des modèles : un modèle de CV décrit en JSON (aucun code), que n'importe qui peut
// écrire et que l'admin téléverse. Le moteur (congo.js) le dessine en PDF, Skia et Word.
// Référence : docs/modeles-dsl.md.
import { z } from 'zod';
import { fromSpec } from './congo.js';
import { fromCanvas } from './canvas.js';

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

// --- Variante « canvas » : primitives posées sur la page + zones de contenu ----------------
const num = z.number().finite();
const col = z.string().regex(/^(#[0-9a-fA-F]{6}|\$[a-zA-Z]{1,20})$/, 'couleur #RRGGBB ou $nom');
const base = { page: z.enum(['first', 'all']).optional() };
const textProps = { font: z.enum(['sans', 'mono']).optional(), weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(), size: num.min(5).max(48).optional(), color: col.optional(), align: z.enum(['left', 'center', 'right']).optional(), upper: z.boolean().optional(), tracking: num.min(-2).max(6).optional(), lineHeight: num.min(5).max(60).optional() };
const element = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rect'), x: num, y: num, w: num, h: num, r: num.optional(), fill: col.optional(), stroke: col.optional(), lw: num.optional(), ...base }).strict(),
  z.object({ type: z.literal('line'), x1: num, y1: num, x2: num, y2: num, color: col.optional(), lw: num.optional(), ...base }).strict(),
  z.object({ type: z.literal('circle'), cx: num, cy: num, r: num, fill: col.optional(), ...base }).strict(),
  z.object({ type: z.literal('poly'), points: z.array(z.tuple([num, num])).min(3).max(40), fill: col.optional(), ...base }).strict(),
  z.object({ type: z.literal('text'), x: num, y: num, w: num.optional(), text: z.string().max(300), ...textProps, ...base }).strict(),
  z.object({ type: z.literal('photo'), x: num, y: num, w: num, h: num, shape: z.enum(['rect', 'circle']).optional(), r: num.optional(), bg: col.optional(), hideEmpty: z.boolean().optional(), ...base }).strict(),
  z.object({ type: z.literal('contacts'), x: num, y: num, w: num.optional(), labels: z.union([z.boolean(), z.literal('above')]).optional(), labelColor: col.optional(), gap: num.optional(), ...textProps, ...base }).strict(),
]);
const area = z.object({ x: num.min(0).max(560), y: num.min(0).max(800).optional(), w: num.min(60).max(560), content: z.array(z.enum(['summary', 'timeline', 'text', 'bullets', 'list', 'rest'])).optional(), flow: z.boolean().optional() }).strict();
export const canvasSpec = z
  .object({
    kind: z.literal('canvas'),
    id: templateSpec.shape.id,
    name: templateSpec.shape.name,
    page: z.object({ background: col.optional(), top: num.min(10).max(200).optional(), bottom: num.min(10).max(200).optional() }).strict().optional(),
    colors: z.record(z.string().regex(/^[a-zA-Z]{1,20}$/), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
    decor: z.array(element).max(120).optional(),
    header: z.array(element).max(80).optional(),
    areas: z.array(area).min(1).max(3),
    section: z
      .object({
        font: z.enum(['sans', 'mono']).optional(),
        size: num.min(7).max(13).optional(),
        color: col.optional(),
        muted: col.optional(),
        spacing: num.min(0).max(40).optional(),
        bullet: z.enum(['dot', 'check', 'arrow', 'dash', 'square', 'none']).optional(),
        bulletColor: col.optional(),
        period: z.object({ color: col.optional(), weight: textProps.weight, font: textProps.font, position: z.enum(['inline', 'above']).optional() }).strict().optional(),
        heading: z
          .object({
            size: num.min(7).max(20).optional(), weight: textProps.weight, font: textProps.font, color: col.optional(), upper: z.boolean().optional(), tracking: textProps.tracking,
            align: z.enum(['left', 'center']).optional(), height: num.min(10).max(40).optional(), gap: num.min(0).max(30).optional(),
            band: col.optional(), box: col.optional(), radius: num.min(0).max(20).optional(),
            underline: z.union([z.boolean(), z.literal('full')]).optional(), underlineColor: col.optional(), underlineWidth: num.min(0.2).max(4).optional(),
            marker: z.enum(['diamond', 'dot', 'bar']).optional(), markerColor: col.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// → { ok: true, spec } ou { ok: false, error } (message lisible pour l'admin).
export function parseTemplateSpec(raw) {
  const r = (raw?.kind === 'canvas' ? canvasSpec : templateSpec).safeParse(raw);
  if (r.success) return { ok: true, spec: r.data };
  const i = r.error.issues[0];
  return { ok: false, error: `${i.path.join('.') || 'modèle'} : ${i.message}` };
}

export const templateFromSpec = (spec) => (spec?.kind === 'canvas' ? fromCanvas(canvasSpec.parse(spec)) : fromSpec(templateSpec.parse(spec)));
