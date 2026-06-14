// Color scales for the three view modes. All return [r, g, b].
const DELAY_STOPS = [
  [-30, [40, 200, 100]],
  [0, [60, 200, 90]],
  [15, [235, 215, 60]],
  [30, [245, 150, 45]],
  [60, [232, 60, 50]],
  [120, [175, 25, 45]],
];
const ALT_STOPS = [
  [0, [255, 95, 95]],
  [3000, [255, 175, 60]],
  [7000, [120, 225, 120]],
  [11000, [95, 190, 255]],
  [14000, [150, 130, 255]],
];

export const UNKNOWN = [150, 160, 170];
const GREEN = [60, 200, 90];
const CAUSE = [180, 90, 255];

function interp(stops, v) {
  if (v == null || Number.isNaN(v)) return UNKNOWN;
  if (v <= stops[0][0]) return stops[0][1];
  if (v >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t));
    }
  }
  return UNKNOWN;
}

export const delayColor = (m) => interp(DELAY_STOPS, m);
export const altColor = (m) => interp(ALT_STOPS, m);

export function colorFor(a, mode) {
  if (mode === 'altitude') return altColor(a.alt);
  if (a.delayMin == null) return UNKNOWN;
  if (mode === 'delay') return a.delayMin <= 5 ? GREEN : delayColor(a.delayMin);
  // genome mode: green = on time, purple = origin/cause, red-scale = victim
  if (a.delayMin <= 5) return GREEN;
  const prim = a.primaryDelayMin || 0;
  const react = a.reactionaryDelayMin || 0;
  if (prim >= react) return CAUSE;
  return delayColor(a.delayMin);
}

function gradientCss(stops, lo, hi) {
  const parts = stops.map(([v, c]) => {
    const p = Math.max(0, Math.min(100, Math.round(((v - lo) / (hi - lo)) * 100)));
    return `rgb(${c[0]},${c[1]},${c[2]}) ${p}%`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export function legendFor(mode) {
  if (mode === 'altitude') {
    return {
      kind: 'gradient',
      title: 'Altitude',
      css: gradientCss(ALT_STOPS, 0, 14000),
      labels: ['ground', '10k ft', '23k ft', '46k ft'],
    };
  }
  if (mode === 'delay') {
    return {
      kind: 'gradient',
      title: 'Arrival delay',
      css: gradientCss(DELAY_STOPS, -30, 120),
      labels: ['on time', '15m', '30m', '60m+'],
    };
  }
  return {
    kind: 'cats',
    title: 'Delay genome',
    items: [
      { c: 'rgb(60,200,90)', l: 'on time' },
      { c: 'rgb(180,90,255)', l: 'delay origin (cause)' },
      { c: 'rgb(232,60,50)', l: 'knock-on (victim)' },
    ],
  };
}
