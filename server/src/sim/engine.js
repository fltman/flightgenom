import { AIRPORTS } from './airports.js';
import { haversineKm, interpolate, bearing } from './geo.js';
import { propagateGenome, MIN_TURN_MS, MIN_CONNECT_MS } from '../genome/propagate.js';
import { estimatePax } from '../pax.js';

const H = 3600 * 1000;
const MIN = 60 * 1000;
const TAXI_OVERHEAD_MS = 30 * MIN; // climb + descent + taxi on top of cruise time
const CRUISE_KMH = 820;
const CRUISE_ALT_M = 11000;
const CONNECT_PROB = 0.3; // share of departures that "wait" for an inbound connection

const AIRLINES = ['SAS', 'NAX', 'DLH', 'KLM', 'RYR', 'EZY', 'BAW', 'FIN', 'AFR', 'IBE'];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function blockMs(from, to) {
  const km = haversineKm([from.lon, from.lat], [to.lon, to.lat]);
  return (km / CRUISE_KMH) * H + TAXI_OVERHEAD_MS;
}

/**
 * A synthetic European airline network. Aircraft fly multi-leg rotations on a
 * schedule. We inject "primary" delays (weather windows, tech issues) and then
 * propagate them through TWO causal edge types:
 *
 *   1. rotation  — a late arrival delays the SAME aircraft's next departure
 *   2. connection— a late arrival delays OTHER aircraft's departures that wait
 *                  for its passengers/crew  → this is what makes the cascade a
 *                  branching tree rather than a chain
 *
 * Each leg gets a single binding parent (the cause that actually set its
 * departure time) plus a *genome*: the ordered list of upstream flights whose
 * delay knocked on into it, root first.
 */
export class SimEngine {
  constructor({ fleet = 70, speed = 1 } = {}) {
    this.speed = speed;
    const nowMs = Date.now();
    this.anchor = nowMs;
    this.t0 = nowMs;
    this.legs = [];
    this.byId = new Map();
    this._build(fleet, nowMs);
  }

  now() {
    return this.anchor + (Date.now() - this.t0) * this.speed;
  }

  _build(fleet, nowMs) {
    let seq = 0;
    for (let i = 0; i < fleet; i++) {
      const airline = pick(AIRLINES);
      const baseNo = 100 + Math.floor(Math.random() * 8900);
      const hex = (0x400000 + Math.floor(Math.random() * 0x3fffff)).toString(16);
      let here = pick(AIRPORTS);
      let t = nowMs + rnd(-4 * H, 1.5 * H); // first departure around "now"
      const nLegs = Math.round(rnd(3, 6));
      let prev = null;
      for (let l = 0; l < nLegs; l++) {
        let dest = pick(AIRPORTS);
        let guard = 0;
        while (dest.code === here.code && guard++ < 10) dest = pick(AIRPORTS);
        const bms = blockMs(here, dest);
        const callsign = `${airline}${baseNo + l}`;
        const leg = {
          id: `${callsign}_${seq++}`,
          callsign,
          hex,
          airline,
          origin: here.code,
          dest: dest.code,
          o: [here.lon, here.lat],
          d: [dest.lon, dest.lat],
          schedDep: t,
          schedArr: t + bms,
          blockMs: bms,
          primaryInjMin: 0,
          prev,
          conn: null,
          pax: estimatePax({ seed: `${callsign}_${seq}` }),
        };
        this.legs.push(leg);
        this.byId.set(leg.id, leg);
        prev = leg;
        here = dest;
        t = leg.schedArr + MIN_TURN_MS + rnd(5, 35) * MIN; // tight-ish turnarounds
      }
    }
    this._assignConnections();
    this._injectDelays(nowMs);
    propagateGenome(this.legs);
  }

  // Some departures wait for a specific inbound flight (different aircraft).
  _assignConnections() {
    const arrivalsByApt = new Map();
    for (const leg of this.legs) {
      if (!arrivalsByApt.has(leg.dest)) arrivalsByApt.set(leg.dest, []);
      arrivalsByApt.get(leg.dest).push(leg);
    }
    for (const dep of this.legs) {
      if (Math.random() > CONNECT_PROB) continue;
      const inbounds = arrivalsByApt.get(dep.origin) || [];
      const eligible = inbounds.filter(
        (inb) =>
          inb.hex !== dep.hex &&
          inb.schedArr <= dep.schedDep - MIN_CONNECT_MS &&
          inb.schedArr >= dep.schedDep - 110 * MIN
      );
      if (eligible.length) dep.conn = pick(eligible);
    }
  }

  _injectDelays(nowMs) {
    for (let e = 0; e < 2; e++) {
      const apt = pick(AIRPORTS).code;
      const start = nowMs + rnd(-3 * H, 1.5 * H);
      const dur = rnd(1.5, 3) * H;
      const sev = rnd(35, 95);
      for (const leg of this.legs) {
        if (leg.origin === apt && leg.schedDep >= start && leg.schedDep <= start + dur) {
          leg.primaryInjMin += sev * rnd(0.5, 1);
        }
      }
    }
    const nTech = Math.max(2, Math.round(this.legs.length * 0.05));
    for (let i = 0; i < nTech; i++) pick(this.legs).primaryInjMin += rnd(20, 60);
  }

  fetchAircraft() {
    const now = this.now();
    const out = [];
    for (const leg of this.legs) {
      if (now < leg.actDep || now > leg.actArr) continue;
      const f = (now - leg.actDep) / (leg.actArr - leg.actDep);
      const pos = interpolate(leg.o, leg.d, f);
      const track = bearing(pos, leg.d);
      let alt = CRUISE_ALT_M;
      if (f < 0.12) alt = CRUISE_ALT_M * (f / 0.12);
      else if (f > 0.88) alt = CRUISE_ALT_M * ((1 - f) / 0.12);
      out.push({
        id: leg.id,
        hex: leg.hex,
        callsign: leg.callsign,
        lat: pos[1],
        lon: pos[0],
        track,
        speed: CRUISE_KMH / 3.6,
        alt,
        onGround: false,
        origin: leg.origin,
        dest: leg.dest,
        delayMin: leg.delayMin,
        primaryDelayMin: leg.primaryDelayMin,
        reactionaryDelayMin: leg.reactionaryDelayMin,
        genome: leg.genome,
        rootId: leg.rootId,
        parentId: leg.parentId,
        causeKind: leg.causeKind,
        blastRadius: leg.blastRadius,
        pax: leg.pax,
      });
    }
    return out;
  }

  graph() {
    return this.legs.map((l) => ({
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
      pax: l.pax,
    }));
  }
}
