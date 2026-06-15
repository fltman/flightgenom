import * as sim from './sim.js';
import * as opensky from './opensky.js';
import * as aeroapi from './aeroapi.js';
import * as livesim from './livesim.js';
import { makeReadsb } from './readsb.js';

const READSB = new Set(['adsblol', 'adsbfi', 'airplaneslive']);

export function getSource(name) {
  if (name === 'sim') return sim;
  if (name === 'livesim') return livesim;
  if (name === 'opensky') return opensky;
  if (name === 'aeroapi') return aeroapi;
  if (READSB.has(name)) return makeReadsb(name);
  throw new Error(`Unknown DATA_SOURCE: ${name}`);
}
