// Deterministic pseudo-delay per aircraft, so the green→red color scale is
// demonstrable on LIVE ADS-B without any schedule API. Clearly SIMULATED — the
// UI shows a badge whenever this is active. Most flights land near "on time",
// with a delayed tail.
export async function enrich(list) {
  for (const a of list) a.delayMin = pseudoDelay(a.id || a.callsign || '');
  return list;
}

function pseudoDelay(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = ((h >>> 0) % 10000) / 10000; // stable 0..1
  return Math.round(Math.pow(r, 2.3) * 130) - 6; // skewed low, tail to ~+124
}
