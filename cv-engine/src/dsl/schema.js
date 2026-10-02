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

const tagGroup = z.object({ label: str(60).optional(), items: z.array(str(60)).max(40) });

const listItem = z.object({ name: str(80), level: str(40).optional() });

// Types de sections génériques : le titre est libre (Expériences, Formation,
// Projets, Bénévolat...), seul le type décide de la mise en forme.
const section = z.discriminatedUnion('type', [
  z.object({ type: z.literal('timeline'), title: str(60), items: z.array(timelineItem).max(20) }),
  z.object({ type: z.literal('tags'), title: str(60), groups: z.array(tagGroup).max(10) }),
  z.object({ type: z.literal('list'), title: str(60), items: z.array(listItem).max(20) }),
  z.object({ type: z.literal('text'), title: str(60), body: str(1500) }),
]);

export const resumeSchema = z.object({
  version: z.literal(1).default(1),
  template: z.enum(['minimal']).default('minimal'),
  theme: z.object({ accent: hex.optional() }).default({}),
  profile: z.object({
    name: str(80).min(1, 'Le nom est obligatoire'),
    title: str(120).optional(),
    badge: str(60).optional(),
    email: str(120).optional(),
    phone: str(40).optional(),
    location: str(80).optional(),
    links: z.array(link).max(5).default([]),
    summary: str(800).optional(),
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
