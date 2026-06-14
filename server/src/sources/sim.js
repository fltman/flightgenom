import { SimEngine } from '../sim/engine.js';
import { AIRPORTS } from '../sim/airports.js';

let engine = null;

export function init(cfg) {
  engine = new SimEngine({ fleet: cfg.simFleet, speed: cfg.simSpeed });
}

export async function fetchAircraft(cfg) {
  if (!engine) init(cfg);
  return engine.fetchAircraft();
}

export function meta() {
  return { airports: AIRPORTS, hasGenome: true, attribution: 'Simulated network' };
}

export function graph() {
  return engine ? engine.graph() : [];
}
