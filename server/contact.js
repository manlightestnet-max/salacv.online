// Coordonnées de salacv (saisies dans l'admin, affichées sur le site) : chaque champ est validé et remis en forme.
// Un champ vide est permis : il n'apparaît simplement pas sur le site.
export const CONTACT_KEYS = ['contact.email', 'contact.whatsapp', 'contact.facebook', 'contact.tiktok'];

const RULES = {
  'contact.email': (v) => (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) ? v.toLowerCase() : null),
  // Numéro du Congo : +242 puis 9 chiffres (espaces, points et tirets acceptés à la saisie, retirés à l'enregistrement).
  'contact.whatsapp': (v) => {
    const n = v.replace(/[\s.()-]/g, '').replace(/^00/, '+');
    return /^\+242\d{9}$/.test(n) ? n : null;
  },
  'contact.facebook': (v) => (/^https:\/\/(www\.|m\.|web\.)?(facebook|fb)\.com\/[^\s<>"']{1,200}$/i.test(v) ? v : null),
  'contact.tiktok': (v) => (/^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9._]{1,40}\/?$/.test(v) ? v : null),
};

const ERRORS = {
  'contact.email': 'E-mail invalide (ex. contact@salacv.online).',
  'contact.whatsapp': 'WhatsApp : un numéro du Congo au format +242 06 123 45 67.',
  'contact.facebook': 'Facebook : l’adresse https de la page (https://www.facebook.com/…).',
  'contact.tiktok': 'TikTok : l’adresse https du compte (https://www.tiktok.com/@…).',
};

/** → { ok: true, value } (valeur remise en forme, '' pour vider) | { ok: false, error } */
export function checkContact(key, raw) {
  if (!RULES[key]) return { ok: false, error: 'Coordonnée inconnue.' };
  const v = String(raw ?? '').trim();
  if (!v) return { ok: true, value: '' };
  const value = RULES[key](v);
  return value ? { ok: true, value } : { ok: false, error: ERRORS[key] };
}
