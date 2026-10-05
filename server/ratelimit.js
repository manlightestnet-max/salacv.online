// Limiteur : fenêtre glissante d'une minute par clé (mémoire du process).
export class RateLimiter {
  constructor(perMinute) {
    this.perMinute = perMinute;
    this.hits = new Map();
  }

  allow(who, now = Date.now()) {
    const recent = (this.hits.get(who) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(who, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(who, recent);
    return true;
  }
}

