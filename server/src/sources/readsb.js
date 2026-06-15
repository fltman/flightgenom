// Generic adapter for readsb / ADSB-Exchange-v2 style JSON feeds.
// These three share an identical schema and a /v2/point/{lat}/{lon}/{radius} route.
//
// LICENSING (verify before going public — see README):
//   adsblol        → data is ODbL 1.0: public redistribution OK *with attribution + share-alike*
//   adsbfi         → free terms are personal/non-commercial, no redistribution
//   airplaneslive  → free terms are non-commercial, no SLA
const BASES = {
  adsblol: 'https://api.adsb.lol/v2',
  adsbfi: 'https://opendata.adsb.fi/api/v2',
  airplaneslive: 'https://api.airplanes.live/v2',
};

// Human-readable attribution per feed. adsb.lol is ODbL and requires
// attribution + share-alike when redistributed publicly (see README/LICENSING).
const ATTRIBUTION = {
  adsblol: 'adsb.lol (ODbL)',
  adsbfi: 'adsb.fi',
  airplaneslive: 'airplanes.live',
};

const KN_TO_MS = 0.514444;
const FT_TO_M = 0.3048;

export function makeReadsb(name) {
  const base = BASES[name];
  if (!base) throw new Error(`Unknown readsb feed: ${name}`);

  return {
    meta() {
      return { airports: [], hasGenome: false, attribution: ATTRIBUTION[name] || name };
    },

    async fetchAircraft(cfg) {
      const [lat, lon] = cfg.center;
      const radius = Math.min(cfg.radiusNm, 250);
      const res = await fetch(`${base}/point/${lat}/${lon}/${radius}`, {
        headers: { 'User-Agent': 'flightgenom/0.1 (https://github.com/fltman/flightgenom)' },
      });
      if (!res.ok) throw new Error(`${name} ${res.status}`);
      const j = await res.json();
      const ac = j.ac || j.aircraft || [];
      return ac
        .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
        .map((a) => ({
          id: a.hex,
          hex: a.hex,
          callsign: (a.flight || '').trim(),
          lat: a.lat,
          lon: a.lon,
          track: a.track ?? a.true_heading ?? 0,
          speed: typeof a.gs === 'number' ? a.gs * KN_TO_MS : 0,
          alt: a.alt_baro === 'ground' ? 0 : typeof a.alt_baro === 'number' ? a.alt_baro * FT_TO_M : null,
          onGround: a.alt_baro === 'ground',
          type: a.t || null, // ICAO aircraft type (used to estimate passengers)
        }));
    },
  };
}
