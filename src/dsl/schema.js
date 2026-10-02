// DSL d'un CV : contenu + choix du template, jamais de positions.
// Le moteur de layout calcule tout le placement à partir de ce JSON.
import { z } from 'zod';

const str = (max = 200) => z.string().trim().max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #RRGGBB');

const link = z.object({ label: str(60), url: str(300).optional() });

const timelineItem = z.object({
  title: str(120),
  org: str(120).optional(),
  location: str(80).optional(),
  period: str(60).optional(),
  bullets: z.array(str(400)).max(12).default([]),
});

const listItem = z.object({ name: str(80), level: str(40).optional() });

// Types de sections génériques : le titre est libre (Formation, Expérience
// professionnelle, Loisirs...), seul le type décide de la mise en forme.
// ghost : contenu d'exemple affiché en grisé dans l'aperçu tant que l'étudiant
// n'a pas rempli la section (jamais dans le PDF téléchargé).
const ghost = { ghost: z.boolean().optional() };

const section = z.discriminatedUnion('type', [
  z.object({ type: z.literal('timeline'), title: str(60), items: z.array(timelineItem).max(20), ...ghost }),
  z.object({ type: z.literal('bullets'), title: str(60), items: z.array(str(120)).max(40), ...ghost }),
  z.object({ type: z.literal('list'), title: str(60), items: z.array(listItem).max(20), ...ghost }),
  z.object({ type: z.literal('text'), title: str(60), body: str(1500), ...ghost }),
]);

export const resumeSchema = z.object({
  version: z.literal(1).default(1),
  template: z.enum(['minimal', 'bandeau', 'vitae', 'diagonale', 'epure', 'marine', 'contraste']).default('minimal'),
  theme: z.object({ accent: hex.optional() }).default({}),
  profile: z.object({
    name: str(80).min(1, 'Le nom est obligatoire'),
    title: str(120).optional(),
    badge: str(60).optional(),
    email: str(120).optional(),
    phones: z.array(str(40)).max(3).default([]),
    address: str(160).optional(),
    links: z.array(link).max(5).default([]),
    // Photo d'identité recadrée côté client (carré JPEG/PNG en data URL, ~40 Ko).
    photo: z
      .string()
      .regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'Photo : image JPEG ou PNG attendue')
      .max(700_000, 'Photo trop lourde')
      .optional(),
    // Profil professionnel : affiché en première section. Un paragraphe par ligne.
    summary: str(1200).optional(),
    // Champs d'en-tête venant de l'exemple (affichés en grisé, voir `ghost` plus haut).
    ghost: z.array(z.enum(['name', 'title', 'contact', 'summary'])).default([]),
  }),
  sections: z.array(section).max(12).default([]),
});

// Retourne { ok: true, resume } ou { ok: false, errors: [{ path, message }] }.
export function parseResume(input) {
  const r = resumeSchema.safeParse(input);
  if (r.success) return { ok: true, resume: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
