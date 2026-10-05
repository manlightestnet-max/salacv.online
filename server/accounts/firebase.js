// Comptes Google via Firebase : le navigateur se connecte à Google (page /auth/), Firebase donne un
// jeton d'identité (ID token), et c'est ICI qu'on le vérifie (clés de Google, émetteur, audience,
// expiration). salacv ne voit jamais de mot de passe.
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Même projet Firebase que LightPay et Salacope : un seul compte pour tout.
const projectId = (env) => env.FIREBASE_PROJECT_ID || 'lightpay-a5f01';

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

// jwks : injectable pour les tests (clé locale) ; par défaut les clés publiques de Google.
// → { uid, email, name, picture } ou null
export async function verifyFirebaseIdToken(token, env = process.env, { jwks = GOOGLE_KEYS, now } = {}) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 4096) return null;
  const pid = projectId(env);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${pid}`,
      audience: pid,
      algorithms: ['RS256'],
      ...(now ? { currentDate: new Date(now) } : {}),
    });
    if (!payload.sub || payload.sub.length > 128 || typeof payload.email !== 'string' || payload.email_verified === false) return null;
    return {
      uid: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === 'string' ? payload.name.slice(0, 80) : '',
      picture: typeof payload.picture === 'string' ? payload.picture : '',
    };
  } catch {
    return null;
  }
}
