// In-memory store of the latest aircraft snapshot, keyed by id.
export class AircraftState {
  constructor(ttlMs = 120000) {
    this.map = new Map();
    this.ttl = ttlMs;
  }

  // Merge updates (for live ADS-B, where aircraft drop in and out of coverage).
  merge(list) {
    const now = Date.now();
    for (const a of list) this.map.set(a.id, { ...a, ts: now });
    for (const [id, a] of this.map) if (now - a.ts > this.ttl) this.map.delete(id);
  }

  // Replace the whole set (for the sim, which always reports every airborne flight).
  replace(list) {
    this.map.clear();
    const now = Date.now();
    for (const a of list) this.map.set(a.id, { ...a, ts: now });
  }

  all() {
    return [...this.map.values()];
  }

  inBounds(b) {
    if (!b) return this.all();
    const [w, s, e, n] = b;
    return this.all().filter((a) => a.lon >= w && a.lon <= e && a.lat >= s && a.lat <= n);
  }
}
