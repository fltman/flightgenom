import 'dotenv/config';

const num = (v, d) => (v !== undefined && v !== '' ? Number(v) : d);
const list = (v, d) => (v ? v.split(',').map(Number) : d);

export const config = {
  port: num(process.env.PORT, 8099),

  // sim | adsblol | adsbfi | airplaneslive | opensky | aeroapi
  dataSource: process.env.DATA_SOURCE || 'sim',
  pollIntervalMs: num(process.env.POLL_INTERVAL_MS, 2000),

  // genome | delay | altitude
  colorMode: process.env.COLOR_MODE || 'genome',

  // ── sim engine (delay-genome demo) ──
  simFleet: num(process.env.SIM_FLEET, 70),
  simSpeed: num(process.env.SIM_SPEED, 1),

  // ── live ADS-B: readsb-style point query (adsb.lol / adsb.fi / airplanes.live) ──
  center: list(process.env.CENTER, [59.3293, 18.0686]), // [lat, lon] — Stockholm
  radiusNm: num(process.env.RADIUS_NM, 250),

  // ── live ADS-B: OpenSky region bbox [W,S,E,N] (research/non-profit use only) ──
  bbox: list(process.env.BBOX, [-11, 35, 30, 62]),
  openskyClientId: process.env.OPENSKY_CLIENT_ID || '',
  openskyClientSecret: process.env.OPENSKY_CLIENT_SECRET || '',

  // ── REAL delay genome via FlightAware AeroAPI (DATA_SOURCE=aeroapi) ──
  // Pay-per-query; uses the BBOX above for the live search. Without a key the
  // source is inert (returns no aircraft). See README "Real genome via AeroAPI".
  aeroapiKey: process.env.AEROAPI_KEY || '',

  // ── delay enrichment for LIVE sources only: none | mock | aviationstack ──
  scheduleSource: process.env.SCHEDULE_SOURCE || 'none',
  aviationstackKey: process.env.AVIATIONSTACK_KEY || '',

  // ── AI network analyst (OpenRouter) ──
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  analystModel: process.env.ANALYST_MODEL || 'anthropic/claude-opus-4.8',
};
