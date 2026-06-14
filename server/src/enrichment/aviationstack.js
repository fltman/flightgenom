// Real delay enrichment via AviationStack (https://aviationstack.com).
// Best-effort: keyed by callsign→flight_icao, cached, and throttled to a few
// lookups per tick because free tiers are tightly rate-limited and the
// callsign↔flight-number match is fuzzy. Flights without a confident match
// stay delayMin=null (rendered as "unknown"). For serious use prefer
// FlightAware AeroAPI, which also returns aircraft rotations directly.
const cache = new Map(); // callsign -> { delayMin, exp }
const TTL = 5 * 60 * 1000;
const MAX_LOOKUPS_PER_TICK = 6;

export async function enrich(list, cfg) {
  const key = cfg.aviationstackKey;
  if (!key) {
    for (const a of list) a.delayMin = null;
    return list;
  }
  const now = Date.now();
  const misses = [];
  for (const a of list) {
    const cs = (a.callsign || '').replace(/\s+/g, '');
    if (!cs) {
      a.delayMin = null;
      continue;
    }
    const c = cache.get(cs);
    if (c && c.exp > now) a.delayMin = c.delayMin;
    else {
      a.delayMin = null;
      misses.push({ a, cs });
    }
  }
  for (const { a, cs } of misses.slice(0, MAX_LOOKUPS_PER_TICK)) {
    try {
      const url = `http://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(
        key
      )}&flight_icao=${encodeURIComponent(cs)}&limit=1`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      const f = j.data && j.data[0];
      const delay = f ? f.arrival?.delay ?? f.departure?.delay ?? null : null;
      cache.set(cs, { delayMin: delay, exp: now + TTL });
      a.delayMin = delay;
    } catch {
      /* leave as null */
    }
  }
  return list;
}
