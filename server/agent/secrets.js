// Secrets à ne jamais montrer au modèle ni renvoyer au client : masqués partout.
const MIN_LENGTH = 8;

export function redact(text, secrets) {
  let out = String(text ?? '');
  // Les plus longues d'abord : une clé ne doit pas être masquée à moitié par une autre.
  for (const s of [...secrets].filter((s) => s.length >= MIN_LENGTH).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join('***');
  }
  return out;
}
