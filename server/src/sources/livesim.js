// livesim — REAL live ADS-B positions + a SIMULATED delay genome layered on top.
//
// Free path to the full genome experience on real aircraft: positions come from
// a keyless ADS-B feed (adsb.lol / airplanes.live / adsb.fi); each real plane
// gets STICKY synthetic attributes (a plausible origin/dest from its actual
// heading, and a pseudo-delay), and we fabricate a coherent, branching cascade
// among the currently-airborne planes (a parent hands delay off to a child at a
// shared airport, more-delayed → less-delayed, acyclic). Output shapes match the
// `sim` source exactly, so the whole UI works unchanged. The relationships are
// invented — it simulates the *effect*, it is not real causality.
import { makeReadsb } from './readsb.js';
import { WORLD_AIRPORTS } from '../sim/airports-world.js';
import { haversineKm, bearing } from '../sim/geo.js';

let feed = null;
let feedName = 'airplaneslive';
let lastModel = [];
const sticky = new Map(); // hex -> { origin, dest, primaryInjMin, kind }

export function init(cfg) {
  feedName = cfg.livesimFeed || 'airplaneslive';
  feed = makeReadsb(feedName);
}

// ── deterministic per-aircraft hashing (stable across polls) ──
function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const rand01 = (s) => (fnv(s) % 100000) / 100000;

function pseudoPrimary(hex) {
  if (rand01('d' + hex) < 0.62) return 0; // ~62% on time
  return Math.round(Math.pow(rand01('m' + hex), 1.8) * 85) + 6; // 6..~91 min
}

const angDiff = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// Nearest airport ahead (dest) and behind (origin) along the plane's heading.
function assignAirports(lat, lon, track) {
  const from = [lon, lat];
  let dest = null;
  let dd = Infinity;
  let origin = null;
  let od = Infinity;
  for (const a of WORLD_AIRPORTS) {
    const dist = haversineKm(from, [a.lon, a.lat]);
    if (dist < 30) continue;
    const brg = bearing(from, [a.lon, a.lat]);
    if (angDiff(brg, track) <= 75 && dist < dd) {
      dd = dist;
      dest = a;
    }
    if (angDiff(brg, (track + 180) % 360) <= 75 && dist < od) {
      od = dist;
      origin = a;
    }
  }
  const nearest = (exclude) => {
    let best = null;
    let bd = Infinity;
    for (const a of WORLD_AIRPORTS) {
      if (exclude && a.code === exclude) continue;
      const dist = haversineKm(from, [a.lon, a.lat]);
      if (dist < bd) {
        bd = dist;
        best = a;
      }
    }
    return best;
  };
  if (!dest) dest = nearest(null);
  if (!origin) origin = nearest(dest?.code);
  return { origin: origin?.code || 'ZZZ', dest: dest?.code || 'ZZZ' };
}

function stickyFor(ac) {
  let s = sticky.get(ac.hex);
  if (!s) {
    const { origin, dest } = assignAirports(ac.lat, ac.lon, ac.track || 0);
    s = {
      origin,
      dest,
      primaryInjMin: pseudoPrimary(ac.hex),
      kind: rand01('k' + ac.hex) < 0.5 ? 'rotation' : 'connection',
    };
    sticky.set(ac.hex, s);
  }
  return s;
}

// Fabricate the cascade over the current set of real aircraft.
function buildModel(list) {
  const legs = list.map((ac) => {
    const s = stickyFor(ac);
    return {
      id: ac.hex,
      hex: ac.hex,
      callsign: ac.callsign || ac.hex,
      lat: ac.lat,
      lon: ac.lon,
      track: ac.track,
      speed: ac.speed,
      alt: ac.alt,
      onGround: ac.onGround,
      origin: s.origin,
      dest: s.dest,
      kind: s.kind,
      primaryDelayMin: Math.round(s.primaryInjMin),
      reactionaryDelayMin: 0,
      delayMin: 0,
      genome: [],
      parentId: null,
      rootId: null,
      causeKind: null,
      blastRadius: 0,
    };
  });

  const byDest = new Map();
  for (const l of legs) {
    if (!byDest.has(l.dest)) byDest.set(l.dest, []);
    byDest.get(l.dest).push(l);
  }
  // Rank: most-delayed first → roots; deterministic tiebreak by hex.
  const order = [...legs].sort((a, b) => b.primaryDelayMin - a.primaryDelayMin || (a.hex < b.hex ? -1 : 1));
  const rank = new Map(order.map((l, i) => [l.id, i]));

  // A child can adopt a parent that hands delay off at the child's origin airport
  // (parent.dest === child.origin), is more delayed (ranked earlier → acyclic),
  // and actually has a primary delay. Hash-gated so not everything links.
  for (const child of legs) {
    if (rand01('p' + child.hex) > 0.4) continue;
    const cands = (byDest.get(child.origin) || []).filter(
      (p) => p.id !== child.id && rank.get(p.id) < rank.get(child.id) && p.primaryDelayMin > 0
    );
    if (!cands.length) continue;
    cands.sort((a, b) => b.primaryDelayMin - a.primaryDelayMin || (a.hex < b.hex ? -1 : 1));
    // Spread children across eligible (more-delayed) parents rather than piling
    // them all on the single worst one — keeps cascades branchy, not monstrous.
    child._parent = cands[fnv('pc' + child.hex) % cands.length];
  }

  // Propagate in rank order (parents resolved before children).
  for (const leg of order) {
    const p = leg._parent;
    if (p) {
      const factor = 0.4 + rand01('f' + leg.hex) * 0.45;
      const reactionary = Math.max(1, Math.round(p.delayMin * factor));
      leg.reactionaryDelayMin = reactionary;
      leg.delayMin = leg.primaryDelayMin + reactionary;
      leg.parentId = p.id;
      leg.causeKind = leg.kind;
      leg.rootId = p.rootId || p.id;
      leg.genome = [
        ...p.genome,
        { id: p.id, callsign: p.callsign, origin: p.origin, dest: p.dest, contributionMin: reactionary, kind: leg.kind },
      ];
    } else {
      leg.delayMin = leg.primaryDelayMin;
      leg.rootId = leg.primaryDelayMin >= 6 ? leg.id : null;
    }
  }

  // blastRadius = downstream descendants.
  const childrenOf = new Map();
  for (const l of legs) {
    if (l.parentId) {
      if (!childrenOf.has(l.parentId)) childrenOf.set(l.parentId, []);
      childrenOf.get(l.parentId).push(l.id);
    }
  }
  const countDesc = (id, seen) => {
    let n = 0;
    for (const c of childrenOf.get(id) || []) {
      if (seen.has(c)) continue;
      seen.add(c);
      n += 1 + countDesc(c, seen);
    }
    return n;
  };
  for (const l of legs) l.blastRadius = countDesc(l.id, new Set());
  for (const l of legs) delete l._parent;
  return legs;
}

export async function fetchAircraft(cfg) {
  if (!feed) init(cfg);
  const positions = await feed.fetchAircraft(cfg);
  if (sticky.size > 4000) {
    const seen = new Set(positions.map((a) => a.hex));
    for (const k of sticky.keys()) if (!seen.has(k)) sticky.delete(k);
  }
  lastModel = buildModel(positions);
  return lastModel.map((l) => ({
    id: l.id,
    hex: l.hex,
    callsign: l.callsign,
    lat: l.lat,
    lon: l.lon,
    track: l.track,
    speed: l.speed,
    alt: l.alt,
    onGround: l.onGround,
    origin: l.origin,
    dest: l.dest,
    delayMin: l.delayMin,
    primaryDelayMin: l.primaryDelayMin,
    reactionaryDelayMin: l.reactionaryDelayMin,
    genome: l.genome,
    rootId: l.rootId,
    parentId: l.parentId,
    causeKind: l.causeKind,
    blastRadius: l.blastRadius,
  }));
}

export function graph() {
  const now = Date.now();
  return lastModel.map((l) => ({
    id: l.id,
    callsign: l.callsign,
    hex: l.hex,
    origin: l.origin,
    dest: l.dest,
    schedDep: now - 600000,
    schedArr: now + 3600000,
    actDep: now - 600000, // all currently airborne
    actArr: now + 3600000,
    delayMin: l.delayMin,
    primaryDelayMin: l.primaryDelayMin,
    reactionaryDelayMin: l.reactionaryDelayMin,
    parentId: l.parentId,
    causeKind: l.causeKind,
    rootId: l.rootId,
    blastRadius: l.blastRadius,
  }));
}

export function meta() {
  return { airports: WORLD_AIRPORTS, hasGenome: true, attribution: `${feedName} + simulated genome` };
}
