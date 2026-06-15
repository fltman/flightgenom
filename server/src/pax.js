// Estimate passengers on a flight. ADS-B carries no passenger data, so we
// estimate from the aircraft type when it's known (live feeds expose it) and
// otherwise deterministically from a seed — so a given flight always reports the
// same number. Seats × a plausible load factor (70–97%).
const SEATS = {
  // regional / turboprop
  AT76: 78, AT75: 70, DH8D: 78, E75L: 76, E75S: 76, CRJ9: 90, CRJ7: 70, CRJ2: 50,
  E190: 114, E290: 114, E195: 132, E295: 132, SF34: 34, B463: 100, B462: 85,
  // narrowbody
  A319: 140, A320: 180, A321: 220, A19N: 140, A20N: 180, A21N: 220,
  B737: 150, B738: 189, B739: 189, B38M: 189, B39M: 189, B752: 200, B753: 220,
  // widebody
  A332: 280, A333: 300, A338: 280, A339: 300, A359: 330, A35K: 360, A306: 260,
  B763: 260, B764: 280, B772: 320, B77L: 320, B77W: 350, B788: 240, B789: 290,
  B78X: 330, B744: 410, B748: 410, A388: 520,
};

const fnv = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const r01 = (s) => (fnv(s) % 100000) / 100000;

export function estimatePax({ type, seed }) {
  let seats;
  if (type && SEATS[type]) {
    seats = SEATS[type];
  } else {
    const r = r01('s' + seed);
    if (r < 0.15) seats = 50 + Math.round(r01('a' + seed) * 45); // regional 50–95
    else if (r < 0.9) seats = 150 + Math.round(r01('b' + seed) * 70); // narrowbody 150–220
    else seats = 250 + Math.round(r01('c' + seed) * 120); // widebody 250–370
  }
  const load = 0.7 + r01('l' + seed) * 0.27; // 70–97% load factor
  return Math.round(seats * load);
}
