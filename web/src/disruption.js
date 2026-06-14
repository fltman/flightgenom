// Airport disruption layer — "where delay is created". We aggregate each leg's
// PRIMARY (root) delay onto its departure airport, so the bubbles show where new
// delay is born, not where it merely arrives. Reactionary delay is intentionally
// excluded; that's downstream fallout, not origination.
import { ScatterplotLayer } from '@deck.gl/layers';

export function aggregate(legs, airportMap) {
  const acc = new Map(); // code -> {originatedDelayMin, delayedDepartures, totalDepartures}
  for (const l of legs) {
    const code = l.origin;
    if (!code) continue;
    let row = acc.get(code);
    if (!row) {
      row = { originatedDelayMin: 0, delayedDepartures: 0, totalDepartures: 0 };
      acc.set(code, row);
    }
    row.totalDepartures += 1;
    row.originatedDelayMin += l.primaryDelayMin || 0;
    if ((l.delayMin || 0) > 15) row.delayedDepartures += 1;
  }
  const out = [];
  for (const [code, row] of acc) {
    if (row.originatedDelayMin <= 0) continue;
    const a = airportMap[code];
    if (!a) continue;
    out.push({
      code,
      name: a.name || code,
      position: [a.lon, a.lat],
      originatedDelayMin: Math.round(row.originatedDelayMin),
      delayedDepartures: row.delayedDepartures,
      totalDepartures: row.totalDepartures,
    });
  }
  return out;
}

// green → amber → red by originated delay (minutes), matching the delay palette.
const HEAT_STOPS = [
  [0, [60, 200, 90]],
  [60, [235, 215, 60]],
  [180, [245, 150, 45]],
  [480, [232, 60, 50]],
];
function heatColor(m) {
  if (m <= HEAT_STOPS[0][0]) return HEAT_STOPS[0][1];
  const last = HEAT_STOPS[HEAT_STOPS.length - 1];
  if (m >= last[0]) return last[1];
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [a, ca] = HEAT_STOPS[i];
    const [b, cb] = HEAT_STOPS[i + 1];
    if (m >= a && m <= b) {
      const t = (m - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t));
    }
  }
  return last[1];
}

export function makeDisruptionLayer(rows, onHover) {
  return new ScatterplotLayer({
    id: 'airport-disruption',
    data: rows,
    getPosition: (d) => d.position,
    radiusUnits: 'pixels',
    getRadius: (d) => Math.max(8, Math.min(40, 8 + d.delayedDepartures * 4)),
    stroked: true,
    filled: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 1.5,
    getFillColor: (d) => {
      const c = heatColor(d.originatedDelayMin);
      return [c[0], c[1], c[2], 120];
    },
    getLineColor: (d) => {
      const c = heatColor(d.originatedDelayMin);
      return [c[0], c[1], c[2], 220];
    },
    pickable: true,
    onHover,
    updateTriggers: {
      getRadius: rows,
      getFillColor: rows,
      getLineColor: rows,
    },
  });
}
