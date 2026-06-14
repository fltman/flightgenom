// FlightAware AeroAPI v4 source — produces the SAME aircraft shape as the sim
// source (positions + a real delay genome), so the cascade/genome view works on
// REAL flights.
//
// ─── How it works ──────────────────────────────────────────────────────────
//  1. POSITIONS: GET /flights/search?query=-latlong "minLat minLon maxLat maxLon"
//     returns every flight currently in the bounding box, each carrying a
//     `last_position` (lat/lon/altitude/groundspeed/heading) and a stable
//     `fa_flight_id` + `registration`.
//  2. ROTATIONS: for each distinct tail (registration) seen in the box, we fetch
//     GET /flights/{reg}?ident_type=registration which returns that aircraft's
//     recent leg sequence (~last days). We sort those legs by departure time and
//     link each to the previous one (`prev`) — that is the rotation chain.
//  3. GENOME: each leg's own (primary) delay is taken from AeroAPI's
//     `departure_delay` (seconds, negative = early). We feed the legs to the
//     shared propagateGenome() so a late arrival flows into the same aircraft's
//     next departure. We then attach the resulting genome fields to the live
//     positions by fa_flight_id.
//
//  CONNECTIONS (crew/pax waiting on a different aircraft) are NOT observable from
//  AeroAPI, so we only build ROTATION edges. Rotation-only is a documented
//  conservative LOWER BOUND on the true cascade (see README).
//
// ─── Auth ──────────────────────────────────────────────────────────────────
//  Header `x-apikey: <AEROAPI_KEY>`. Base URL https://aeroapi.flightaware.com/aeroapi
//
// ─── Cost (AeroAPI is pay-per-query — be frugal) ────────────────────────────
//  Per refresh we make 1 search call + 1 history call per *new* tail in view.
//  Searches are cheap; history calls dominate. We cache each tail's rotation for
//  ROTATION_TTL_MS so a tail is fetched roughly once, not every tick, and we cap
//  the number of new history calls per refresh (MAX_HISTORY_PER_REFRESH). With a
//  ~busy box of N tails the first refresh costs ~N history calls; steady state is
//  a few calls per refresh as aircraft rotate in/out. AeroAPI bills roughly a
//  fraction of a US cent per result; budget accordingly and keep the box small.

import { propagateGenome } from '../genome/propagate.js';

const BASE = 'https://aeroapi.flightaware.com/aeroapi';
const KN_TO_MS = 0.514444;
const FT_TO_M = 0.3048;
const SEC = 1000;
const MIN = 60 * SEC;

// Refresh cadence + frugality caps. These are intentionally conservative; tune
// for your AeroAPI budget. (The poller still ticks every POLL_INTERVAL_MS, but
// we only hit the network when our cache is older than REFRESH_MS.)
const REFRESH_MS = 60 * SEC; // re-query AeroAPI at most this often
const ROTATION_TTL_MS = 30 * MIN; // a tail's rotation is re-fetched at most this often
const MAX_HISTORY_PER_REFRESH = 12; // cap new tail-history calls per refresh
const SEARCH_MAX_PAGES = 1; // keep search to a single page (frugal)

let cfg = null;
let apiKey = '';
let warnedNoKey = false;

// In-memory caches.
const positions = new Map(); // fa_flight_id -> normalized aircraft (with genome)
const rotations = new Map(); // registration  -> { legs:[...], fetchedAt }
const graphById = new Map(); // fa_flight_id -> graph leg (for /api/graph)
let lastRefresh = 0;
let refreshing = null; // in-flight refresh promise (dedupe concurrent ticks)

export function init(c) {
  cfg = c;
  apiKey = c.aeroapiKey || '';
}

export function meta() {
  return { airports: [], hasGenome: true, attribution: 'FlightAware AeroAPI' };
}

export function graph() {
  return [...graphById.values()];
}

export async function fetchAircraft(c) {
  cfg = c || cfg;
  apiKey = (cfg && cfg.aeroapiKey) || apiKey;

  if (!apiKey) {
    if (!warnedNoKey) {
      console.error('[aeroapi] AEROAPI_KEY is not set — returning no aircraft. Set AEROAPI_KEY in .env to enable the real genome source.');
      warnedNoKey = true;
    }
    return [];
  }

  // Throttle network access to REFRESH_MS regardless of poll interval.
  const now = Date.now();
  if (now - lastRefresh >= REFRESH_MS) {
    // Dedupe: if a refresh is already running, await it; else start one. We
    // never throw out of fetchAircraft — on failure we serve the last snapshot.
    if (!refreshing) {
      refreshing = refresh()
        .catch((e) => console.error('[aeroapi]', e.message))
        .finally(() => {
          lastRefresh = Date.now();
          refreshing = null;
        });
    }
    await refreshing;
  }
  return [...positions.values()];
}

// ─── network helpers ────────────────────────────────────────────────────────

async function api(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'x-apikey': apiKey,
      Accept: 'application/json; charset=UTF-8',
      'User-Agent': 'flightgenom/0.1 (https://github.com/fltman/flightgenom)',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AeroAPI ${res.status} ${path.split('?')[0]} ${body.slice(0, 160)}`);
  }
  return res.json();
}

// Build the -latlong bounding-box query. AeroAPI expects:
//   -latlong "MINLAT MINLON MAXLAT MAXLON"
// Our cfg.bbox is [W, S, E, N] = [minLon, minLat, maxLon, maxLat].
function bboxQuery(bbox) {
  const [w, s, e, n] = bbox;
  const minLat = Math.min(s, n);
  const maxLat = Math.max(s, n);
  const minLon = Math.min(w, e);
  const maxLon = Math.max(w, e);
  return `-latlong "${minLat} ${minLon} ${maxLat} ${maxLon}"`;
}

// ─── refresh: positions + rotations + genome ────────────────────────────────

async function refresh() {
  const bbox = (cfg && cfg.bbox) || [-11, 35, 30, 62];
  const query = bboxQuery(bbox);
  const search = await api(
    `/flights/search?query=${encodeURIComponent(query)}&max_pages=${SEARCH_MAX_PAGES}`
  );
  const inBox = Array.isArray(search.flights) ? search.flights : [];

  // 1) Normalize live positions (drop anything without a usable last_position).
  const live = [];
  for (const f of inBox) {
    const p = f.last_position;
    if (!p || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') continue;
    live.push({
      faId: f.fa_flight_id,
      registration: f.registration || null,
      base: {
        id: f.fa_flight_id || f.ident,
        hex: f.registration || f.ident || f.fa_flight_id,
        callsign: (f.ident || '').trim(),
        lat: p.latitude,
        lon: p.longitude,
        track: typeof p.heading === 'number' ? p.heading : 0,
        speed: typeof p.groundspeed === 'number' ? p.groundspeed * KN_TO_MS : 0,
        // last_position.altitude is in hundreds of feet.
        alt: typeof p.altitude === 'number' ? p.altitude * 100 * FT_TO_M : null,
        onGround: false,
        origin: airportCode(f.origin),
        dest: airportCode(f.destination),
      },
    });
  }

  // 2) Fetch rotations for the tails in view (cached, capped, frugal).
  const tails = [...new Set(live.map((l) => l.registration).filter(Boolean))];
  let historyCalls = 0;
  for (const tail of tails) {
    const cached = rotations.get(tail);
    if (cached && Date.now() - cached.fetchedAt < ROTATION_TTL_MS) continue;
    if (historyCalls >= MAX_HISTORY_PER_REFRESH) break; // stay within budget this refresh
    historyCalls++;
    try {
      const hist = await api(
        `/flights/${encodeURIComponent(tail)}?ident_type=registration&max_pages=1`
      );
      const legs = Array.isArray(hist.flights) ? hist.flights : [];
      rotations.set(tail, { legs, fetchedAt: Date.now() });
    } catch (e) {
      // Don't let one bad tail abort the whole refresh; keep any stale rotation.
      console.error(`[aeroapi] history ${tail}: ${e.message}`);
      if (!rotations.has(tail)) rotations.set(tail, { legs: [], fetchedAt: Date.now() });
    }
  }

  // 3) Build the genome over ALL cached rotations, then index by fa_flight_id.
  rebuildGenome();

  // 4) Attach genome to live positions and publish the snapshot.
  const next = new Map();
  for (const l of live) {
    const g = graphById.get(l.faId) || {};
    next.set(l.faId, {
      ...l.base,
      delayMin: g.delayMin ?? null,
      primaryDelayMin: g.primaryDelayMin ?? 0,
      reactionaryDelayMin: g.reactionaryDelayMin ?? 0,
      genome: g.genome ?? [],
      rootId: g.rootId ?? null,
      parentId: g.parentId ?? null,
      causeKind: g.causeKind ?? null,
      blastRadius: g.blastRadius ?? 0,
    });
  }
  positions.clear();
  for (const [k, v] of next) positions.set(k, v);
}

// Turn every cached tail-rotation into propagateGenome() legs and run it across
// the whole population at once (one tail's chain never affects another's, since
// we only build rotation edges — but running them together keeps the code path
// identical to the sim and lets blastRadius be global).
function rebuildGenome() {
  const allLegs = [];
  for (const { legs } of rotations.values()) {
    const usable = legs
      .filter((f) => f.fa_flight_id && !f.position_only)
      .map(toLeg)
      .filter(Boolean)
      // departure-time order so prev links point backwards
      .sort((a, b) => a.schedDep - b.schedDep);

    let prev = null;
    for (const leg of usable) {
      leg.prev = prev;
      leg.conn = null; // connections not observable from AeroAPI (rotation-only)
      prev = leg;
    }
    allLegs.push(...usable);
  }

  propagateGenome(allLegs);

  graphById.clear();
  for (const l of allLegs) {
    graphById.set(l.id, {
      id: l.id,
      callsign: l.callsign,
      hex: l.hex,
      origin: l.origin,
      dest: l.dest,
      schedDep: l.schedDep,
      schedArr: l.schedArr,
      actDep: l.actDep,
      actArr: l.actArr,
      delayMin: l.delayMin,
      primaryDelayMin: l.primaryDelayMin,
      reactionaryDelayMin: l.reactionaryDelayMin,
      parentId: l.parentId,
      causeKind: l.causeKind,
      rootId: l.rootId,
      blastRadius: l.blastRadius,
      genome: l.genome,
    });
  }
}

// ─── mapping an AeroAPI flight → a propagateGenome() leg ─────────────────────

function airportCode(apt) {
  if (!apt) return null;
  return apt.code_iata || apt.code_icao || apt.code || null;
}

const ts = (s) => (s ? Date.parse(s) : NaN);

// Best available departure time: scheduled gate-out, else runway-off, else
// estimated gate-out. Same precedence for arrival.
function depTime(f) {
  return firstFinite(ts(f.scheduled_out), ts(f.scheduled_off), ts(f.estimated_out));
}
function arrTime(f) {
  return firstFinite(ts(f.scheduled_in), ts(f.scheduled_on), ts(f.estimated_in));
}
function firstFinite(...xs) {
  for (const x of xs) if (Number.isFinite(x)) return x;
  return NaN;
}

function toLeg(f) {
  const schedDep = depTime(f);
  const schedArr = arrTime(f);
  // We need a scheduled window to compute block time + delay. Skip flights with
  // no schedule (position-only / GA), they can't carry a meaningful genome.
  if (!Number.isFinite(schedDep) || !Number.isFinite(schedArr) || schedArr <= schedDep) {
    return null;
  }

  // AeroAPI departure_delay is seconds, negative = early. Treat only positive
  // departure delay as this leg's PRIMARY (own) injected delay; rotation knock-on
  // is then added by propagateGenome via the prev link. We use departure (not
  // arrival) delay because that is what the next leg actually inherits.
  const depDelaySec = typeof f.departure_delay === 'number' ? f.departure_delay : 0;
  const primaryInjMin = Math.max(0, Math.round(depDelaySec / 60));

  return {
    id: f.fa_flight_id,
    callsign: (f.ident || '').trim(),
    hex: f.registration || f.ident || f.fa_flight_id,
    origin: airportCode(f.origin),
    dest: airportCode(f.destination),
    schedDep,
    schedArr,
    blockMs: schedArr - schedDep,
    primaryInjMin,
    prev: null, // set by rebuildGenome()
    conn: null,
  };
}
