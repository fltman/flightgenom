import * as mock from './mock.js';
import * as aviationstack from './aviationstack.js';

// Delay enrichment for LIVE ADS-B sources (which carry no schedule/delay data).
// Returns null when disabled. The sim source provides its own delays + genome.
export function getEnrichment(name) {
  if (!name || name === 'none') return null;
  const m = { mock, aviationstack }[name];
  if (!m) throw new Error(`Unknown SCHEDULE_SOURCE: ${name}`);
  return m;
}
