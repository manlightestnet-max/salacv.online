// Configuration publique du site (aucun secret) : valeurs lues par le navigateur sans connexion, ex. Firebase.
//
//   POST /api/config {}
import { publicConfig } from '../settings.js';

export async function configRoute(env = process.env) {
  return [200, { ok: true, config: await publicConfig(env) }];
}
