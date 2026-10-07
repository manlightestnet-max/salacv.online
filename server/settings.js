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
  // Modèle sur lequel arrivent les visiteurs (landing et nouveau CV) ; un compte reprend son dernier modèle.
  'studio.defaultTemplate': { default: 'minimal', secret: false, public: true, label: 'Modèle par défaut des visiteurs' },
  // Paiement des crédits par LightPay. Les clés secrètes sont chiffrées ; payee = la connexion LightPay du wallet de
  // salacv (obtenue par « Connecter le wallet » dans l'admin), une par environnement.
  'lightpay.env': { default: 'sandbox', secret: false, public: false, label: 'LightPay : environnement (sandbox ou production)' },
  'lightpay.appId': { default: 'salacv', secret: false, public: false, label: 'LightPay : identifiant de l’app' },
  'lightpay.apiUrl': { default: 'https://api.smlab.xyz', secret: false, public: false, label: 'LightPay : adresse de l’API' },
  'lightpay.checkoutUrl': { default: 'https://checkout.smlab.xyz', secret: false, public: false, label: 'LightPay : adresse des pages de paiement' },
  'lightpay.keySandbox': { default: '', secret: true, public: false, label: 'LightPay : clé secrète test (sec_test_…)' },
  'lightpay.keyProduction': { default: '', secret: true, public: false, label: 'LightPay : clé secrète live (sec_live_…)' },
  'lightpay.payeeSandbox': { default: '', secret: false, public: false, label: 'LightPay : wallet de salacv en test (conn_…)' },
  'lightpay.payeeProduction': { default: '', secret: false, public: false, label: 'LightPay : wallet de salacv en réel (conn_…)' },
  // En test, seuls ces comptes voient la boutique ; les autres la voient « momentanément indisponible ».
  'lightpay.testers': { default: '', secret: false, public: false, label: 'LightPay : comptes de test (e-mails, séparés par des virgules)' },
};

const known = (key) => {
  if (!DEFINITIONS[key]) throw new Error(`Réglage inconnu : ${key}`);
  return DEFINITIONS[key];
};

// Un secret chiffré avec une autre clé maîtresse (perdue, changée) ne peut plus être lu : il compte comme
// non renseigné (le service concerné se dit « non configuré ») au lieu de casser tout le serveur ; l'admin le ressaisit.
const readSecret = (value, key, env) => {
  try {
    return { value: open(value, env), unreadable: false };
  } catch (err) {
    console.warn(`[réglages] ${key} illisible : ${err.message}`);
    return { value: '', unreadable: true };
  }
};

export async function getSetting(key, env = process.env) {
  const def = known(key);
  const rows = await query('SELECT value, secret FROM settings WHERE key = $1', [key]);
  if (!rows.length) return def.default;
  return rows[0].secret ? readSecret(rows[0].value, key, env).value || def.default : rows[0].value;
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
    const read = row?.secret ? readSecret(row.value, key, env) : { value: row ? row.value : def.default, unreadable: false };
    const raw = read.value;
    return {
      key,
      label: def.label,
      secret: def.secret,
      public: def.public,
      set: Boolean(row) && !read.unreadable,
      // Chiffré avec une ancienne clé maîtresse : à ressaisir.
      unreadable: read.unreadable,
      value: def.secret ? '' : raw,
      hint: def.secret && raw ? `…${last4(raw)}` : '',
    };
  });
}

// Pour le site (sans connexion) : seulement les réglages publics.
export async function publicConfig(env = process.env) {
  const out = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) if (def.public) out[key] = await getSetting(key, env);
  return out;
}
