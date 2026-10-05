// Réglages de l'application, modifiables par l'admin depuis son interface (rien n'est à redéployer).
// Un réglage « secret » est chiffré en base et ne ressort jamais en clair : on ne le montre que masqué.
import { query } from './db/index.js';
import { last4, open, seal } from './crypto.js';

// Réglages connus : valeur par défaut, secret ou non, public (lisible par le site sans connexion) ou non.
export const DEFINITIONS = {
  // Stockage Cloudflare R2 (CV des comptes, PDF des clients). Les deux clés d'accès sont chiffrées et ne ressortent jamais.
  'r2.accountId': { default: '', secret: false, public: false, label: 'R2 : identifiant de compte Cloudflare' },
  'r2.accessKeyId': { default: '', secret: true, public: false, label: 'R2 : clé d’accès (Access Key ID)' },
  'r2.secretAccessKey': { default: '', secret: true, public: false, label: 'R2 : clé secrète (Secret Access Key)' },
  'r2.bucket': { default: '', secret: false, public: false, label: 'R2 : nom du bucket' },
  // Cadeau d'inscription : crédits offerts une seule fois, à la première connexion (0 = aucun).
  'grant.signupCredits': { default: '3', secret: false, public: false, label: 'Cadeau d’inscription (crédits)' },
  // Quota d'IA du visiteur non connecté (tokens, une seule fois) : par session et par adresse IP.
  'quota.anonTokens': { default: '250000', secret: false, public: false, label: 'Visiteur : tokens IA par session' },
  'quota.ipTokens': { default: '250000', secret: false, public: false, label: 'Visiteur : tokens IA par adresse IP' },
  // Connexion Google (Firebase) : valeurs publiques par nature, servies au site à l'exécution.
  'firebase.apiKey': { default: '', secret: false, public: true, label: 'Firebase : clé web (apiKey)' },
  'firebase.authDomain': { default: 'lightpay-a5f01.firebaseapp.com', secret: false, public: true, label: 'Firebase : authDomain' },
  'firebase.projectId': { default: 'lightpay-a5f01', secret: false, public: true, label: 'Firebase : projectId' },
};

const known = (key) => {
  if (!DEFINITIONS[key]) throw new Error(`Réglage inconnu : ${key}`);
  return DEFINITIONS[key];
};

export async function getSetting(key, env = process.env) {
  const def = known(key);
  const rows = await query('SELECT value, secret FROM settings WHERE key = $1', [key]);
  if (!rows.length) return def.default;
  return rows[0].secret ? open(rows[0].value, env) : rows[0].value;
}

export async function setSetting(key, value, env = process.env) {
  const def = known(key);
  const text = String(value ?? '');
  await query(
    'INSERT INTO settings (key, value, secret) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret = EXCLUDED.secret, updated_at = now()',
    [key, def.secret ? seal(text, env) : text, def.secret],
  );
}

export async function getNumberSetting(key, env = process.env) {
  const n = Number.parseInt(await getSetting(key, env), 10);
  return Number.isFinite(n) && n >= 0 ? n : Number.parseInt(known(key).default, 10);
}

// Pour l'interface admin : tout, les secrets masqués.
export async function listSettings(env = process.env) {
  const rows = new Map((await query('SELECT key, value, secret FROM settings')).map((r) => [r.key, r]));
  return Object.entries(DEFINITIONS).map(([key, def]) => {
    const row = rows.get(key);
    const raw = row ? (row.secret ? open(row.value, env) : row.value) : def.default;
    return { key, label: def.label, secret: def.secret, public: def.public, set: Boolean(row), value: def.secret ? '' : raw, hint: def.secret && raw ? `…${last4(raw)}` : '' };
  });
}

// Pour le site (sans connexion) : seulement les réglages publics.
export async function publicConfig(env = process.env) {
  const out = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) if (def.public) out[key] = await getSetting(key, env);
  return out;
}
