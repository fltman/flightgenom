// OpenSky Network adapter. NOTE: OpenSky's terms restrict the REST API to
// non-profit research/education; any live/operational/commercial product needs a
// written agreement. Quotas are also low for a live map. Included for
// completeness — prefer adsb.lol for a public site. See README.
const API = 'https://opensky-network.org/api';
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let token = { value: null, exp: 0 };

async function getToken(id, secret) {
  if (token.value && Date.now() < token.exp) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) throw new Error(`OpenSky auth ${res.status}`);
  const j = await res.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in - 30) * 1000 };
  return token.value;
}

export function meta() {
  return { airports: [], hasGenome: false, attribution: 'opensky' };
}

export async function fetchAircraft(cfg) {
  const [w, s, e, n] = cfg.bbox;
  const params = new URLSearchParams({
    lamin: String(s),
    lomin: String(w),
    lamax: String(n),
    lomax: String(e),
  });
  const headers = {};
  if (cfg.openskyClientId && cfg.openskyClientSecret) {
    headers.Authorization = `Bearer ${await getToken(cfg.openskyClientId, cfg.openskyClientSecret)}`;
  }
  const res = await fetch(`${API}/states/all?${params}`, { headers });
  if (!res.ok) throw new Error(`OpenSky ${res.status}`);
  const j = await res.json();
  return (j.states || [])
    .filter((st) => st[5] != null && st[6] != null)
    .map((st) => ({
      id: st[0],
      hex: st[0],
      callsign: (st[1] || '').trim(),
      lon: st[5],
      lat: st[6],
      alt: st[13] ?? st[7],
      onGround: st[8],
      speed: st[9] ?? 0, // m/s
      track: st[10] ?? 0,
    }));
}
