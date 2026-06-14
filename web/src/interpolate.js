// Client-side dead-reckoning. Server snapshots arrive every couple of seconds;
// we advance each aircraft along its track every animation frame from its last
// authoritative fix, so motion looks smooth at 60fps. On the next snapshot we
// reset the base fix (no drift accumulates).
const R = 6371000; // m

function dest(lat, lon, brgDeg, distM) {
  const br = (brgDeg * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  const dr = distM / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
  const lo2 =
    lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return [(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI];
}

export class FleetStore {
  constructor() {
    this.map = new Map();
  }

  ingest(list) {
    const now = performance.now();
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id);
      this.map.set(a.id, { ...a, t0: now });
    }
    // drop aircraft we haven't heard about for a while
    for (const [id, a] of this.map) if (now - a.t0 > 90000) this.map.delete(id);
  }

  snapshot(now) {
    const out = [];
    for (const a of this.map.values()) {
      const dt = (now - a.t0) / 1000;
      let position = [a.lon, a.lat];
      if (a.speed > 0 && !a.onGround && dt > 0) position = dest(a.lat, a.lon, a.track, a.speed * dt);
      out.push({ ...a, position });
    }
    return out;
  }
}
