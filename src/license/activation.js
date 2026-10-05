// Activation d'une clé hors ligne sur ce PC : la durée de vie (config.js) démarre à la première
// activation et se garde sur la machine. Le stockage est injecté (Electron : fichier chiffré de
// userData) pour que la logique reste testable.
//
// Limites assumées d'une clé hors ligne : sans serveur, on ne peut pas empêcher de la saisir sur un
// autre PC, ni la révoquer avant sa fin ; on empêche seulement de la réutiliser pour repartir de zéro
// sur ce PC (identifiants déjà activés mémorisés) et de gagner du temps en reculant l'horloge.
import { parseOfflineKey } from './offline.js';
import { lifetimeDays } from './config.js';

const DAY = 86400000;
const CLOCK_TOLERANCE = 10 * 60 * 1000;

// storage : { read() → objet | null, write(objet) } (synchrone ou non)
export function createLicense({ storage, publicKey, now = () => Date.now(), days = () => lifetimeDays('offline') }) {
  const load = async () => ({ record: null, used: {}, lastSeen: 0, ...((await storage.read()) ?? {}) });

  const describe = (data, t) => {
    if (data.lastSeen && t < data.lastSeen - CLOCK_TOLERANCE) return { state: 'clock', error: 'L’horloge de ce PC est en retard sur la dernière utilisation. Remets l’heure à jour.' };
    const r = data.record;
    if (!r) return { state: 'none' };
    const base = { id: r.id, activatedAt: r.activatedAt, expiresAt: r.expiresAt };
    if (t >= r.expiresAt) return { ...base, state: 'expired', daysLeft: 0 };
    return { ...base, state: 'active', daysLeft: Math.max(1, Math.ceil((r.expiresAt - t) / DAY)) };
  };

  return {
    async status() {
      const data = await load();
      const t = now();
      const out = describe(data, t);
      if (out.state !== 'clock' && t > data.lastSeen) await storage.write({ ...data, lastSeen: t });
      return out;
    },

    // → { ok: true, ...statut } | { ok: false, error }
    async activate(key) {
      const parsed = parseOfflineKey(key, publicKey);
      if (!parsed.ok) return parsed;
      const length = days();
      if (!length) return { ok: false, error: 'La durée de vie des clés n’est pas encore définie.' };
      const data = await load();
      const t = now();
      const blocked = describe(data, t);
      if (blocked.state === 'clock') return { ok: false, error: blocked.error };
      const activatedAt = data.used[parsed.id] ?? t; // la même clé ne repart jamais de zéro
      const expiresAt = activatedAt + length * DAY;
      if (t >= expiresAt) return { ok: false, error: 'Cette clé a expiré.' };
      const next = { record: { id: parsed.id, activatedAt, expiresAt }, used: { ...data.used, [parsed.id]: activatedAt }, lastSeen: Math.max(t, data.lastSeen) };
      await storage.write(next);
      return { ok: true, ...describe(next, t) };
    },

    async clear() {
      const data = await load();
      await storage.write({ ...data, record: null });
    },
  };
}
