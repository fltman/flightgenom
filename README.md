# flightgenom

A realtime flight map — like Flightradar24 — with a twist: it tracks the **delay genome**.

Every flight that's running late inherits the IDs of the upstream flights that
*caused* its delay. Follow a delay back to "patient zero", or click any flight to
see the **cascade tree** of everything its delay went on to disrupt.

> **Why a genome?** Aircraft fly leg after leg (A→B→C→D). If a plane lands late,
> its next departure is late too — and flights *waiting for its passengers/crew*
> are delayed as well. So delay propagates along two edges: **rotation** (same
> aircraft) and **connection** (other aircraft). Each flight accumulates the
> ordered set of ancestors whose delay knocked on into it — its genome.

## Quick start

```bash
npm install
npm run dev
```

- Web UI → http://localhost:5190
- API/WS server → http://localhost:8099

By default it runs the **`sim`** data source: a synthetic European airline network
with injected disruptions that cascade through real rotation + connection logic.
The genome algorithm is real; only the underlying flights are synthetic (the UI
shows a **SIMULATED** badge). This lets you see the whole concept with zero setup.

### What to try

1. Toggle the color mode (bottom-left): **genome** (green = on time, purple =
   delay *origin*, red = knock-on victim), **delay** (green→red scale), **altitude**.
2. Click a purple/red plane → the side panel shows **Caused by** (the upstream
   chain) and the **Knock-on cascade** tree. The map draws orange arcs upstream
   and red arcs to every downstream flight it delayed.
3. Click any node in the tree to jump to that flight.
4. **worst cascades** (HUD) — a leaderboard of the root-cause flights whose delay
   rippled the furthest; click one to jump to its cascade.
5. **disruption** (HUD) — graded bubbles at airports showing *where* delay is
   created (sum of primary delay originating there).
6. **AI briefing** (HUD) — an LLM (OpenRouter, model switchable in the panel)
   reads the computed metrics and returns a summary, conclusions, the narrow
   sensitive points (chokepoints), and predictions. Needs `OPENROUTER_API_KEY`.
7. **Mark genomes** — hit **⚑** on a leaderboard row or "⚑ Mark this genome" in
   the cascade panel to pin a genome; every flight carrying it lights up in that
   genome's color and the rest dim. Mark several to compare cascades side by side.

## How it works

```
 data source ──poll──▶ in-memory state ──▶ WebSocket fan-out ──▶ browser
 (sim | adsb.lol)        (+ delay/genome)     (viewport-filtered)   (dead-reckon @60fps
                                                                     + deck.gl/MapLibre)
```

- **Backend** — Fastify + `@fastify/websocket`. Polls the source, holds aircraft
  state in memory, and pushes only the aircraft inside each client's current map
  viewport. `server/src/sim/engine.js` builds the schedule, injects delays, and
  propagates the genome (`/api/graph` exposes the full flight graph for the tree).
- **Frontend** — MapLibre GL basemap + deck.gl `IconLayer` for planes,
  `ArcLayer` for the cascade. Positions are **dead-reckoned** on the client every
  animation frame so motion is smooth between the ~2s server snapshots.

## Using real live data

Set `DATA_SOURCE` in `.env` (copy `.env.example`). Keyless ADS-B feeds give live
positions but **no schedule/delay data**, so for those the genome view needs the
sim — *except* `aeroapi`, which carries a **real genome on real flights** (see
[Real genome via AeroAPI](#real-genome-via-aeroapi) below).

| `DATA_SOURCE` | Auth | Public-site licensing | Notes |
|---|---|---|---|
| `sim` (default) | — | n/a (synthetic) | Full delay genome + cascade tree |
| `adsblol` | keyless | **ODbL — OK with attribution + share-alike** | ✅ recommended free live source |
| `adsbfi` | keyless | non-commercial, no redistribution | personal use only |
| `airplaneslive` | keyless | non-commercial, no SLA | personal use only |
| `opensky` | OAuth2 | **research/non-profit only**, low quota | not for a public map |
| `aeroapi` | `x-apikey` | commercial OK (paid) | ✅ **real flights with a real delay genome** (pay-per-query) |

Live sources use a point query — set `CENTER=lat,lon` and `RADIUS_NM` (≤250).
`opensky` uses a bounding box (`BBOX=W,S,E,N`) and optional
`OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET`.

To color **real** flights by delay, set `SCHEDULE_SOURCE=mock` (clearly-labelled
fake delays, for demoing the scale) or `SCHEDULE_SOURCE=aviationstack` with
`AVIATIONSTACK_KEY` (best-effort, rate-limited, fuzzy callsign matching).

## Roadmap to a real genome on live data

The hard part is schedule + rotation data, not the map. To compute the genome
from real flights you need scheduled-vs-actual times and each aircraft's leg
sequence:

- **FlightAware AeroAPI** returns an aircraft's flight history (rotation)
  directly — the cleanest path. Premium tier allows commercial/B2B use.
- Or reconstruct legs from ADS-B history (takeoff/landing detection per `hex`)
  and join a schedule API (AviationStack / AeroDataBox) for scheduled times.
- Connection edges (crew/pax) aren't observable from ADS-B; approximate them
  from published minimum-connection times + co-located turnarounds, or treat
  rotation-only as a conservative lower bound on the cascade.

For a public production deployment also: self-host basemap tiles (Protomaps
PMTiles on Cloudflare R2 instead of the keyless CARTO tiles used here), honor
the data source's attribution/share-alike terms, and note that "Flightradar24"
is a trademark — don't imply affiliation.

## Real genome via AeroAPI

`DATA_SOURCE=aeroapi` computes a **real delay genome from real flights** using
FlightAware [AeroAPI v4](https://www.flightaware.com/commercial/aeroapi/). The
genome algorithm is the exact same pure module the sim uses
(`server/src/genome/propagate.js`) — only the flights are real.

### Setup

1. Get an AeroAPI key from the FlightAware AeroAPI portal (Personal or higher).
2. In `.env`:
   ```bash
   DATA_SOURCE=aeroapi
   AEROAPI_KEY=your_key_here
   BBOX=-1,51,1,52          # W,S,E,N — keep it SMALL to control cost
   ```
3. `npm run dev`. The map shows live in-box flights colored by their real delay
   genome; `/api/graph` exposes the full rotation tree.

Without `AEROAPI_KEY` the source is inert (returns no aircraft and logs a
one-line notice) — it never crashes the server.

### How the genome is built

Two AeroAPI calls feed the propagator:

1. **Positions** — `GET /flights/search?query=-latlong "minLat minLon maxLat maxLon"`
   returns every flight in the `BBOX`, each with a `last_position`
   (lat/lon/altitude/groundspeed/heading), a stable `fa_flight_id`, and the
   aircraft `registration`.
2. **Rotations** — for each distinct tail (`registration`) seen in the box,
   `GET /flights/{reg}?ident_type=registration` returns that aircraft's recent
   leg sequence. We sort those legs by departure time and link each to the
   previous one (`prev`) — that chain is the **rotation**. Each leg's own
   (primary) delay comes from AeroAPI's `departure_delay` (seconds; negative =
   early → treated as 0 primary). `propagateGenome()` then flows a late arrival
   into the same aircraft's next departure.

**Rotation-only is a documented lower bound.** Connection edges (a *different*
aircraft's departure waiting for this flight's crew/passengers) are **not
observable** from AeroAPI, so the `aeroapi` source builds rotation edges only.
The real cascade is therefore at least as large as what's shown — never larger.
The `sim` source models both edge types to illustrate the full concept.

### Cost (AeroAPI is pay-per-query — be frugal)

AeroAPI bills per query/result, so this source is deliberately frugal:

- Network refresh is throttled to **once per minute** (`REFRESH_MS`) regardless
  of `POLL_INTERVAL_MS`; the WS still streams the cached snapshot every tick.
- Each tail's rotation is cached for **30 min** (`ROTATION_TTL_MS`) — a tail is
  fetched roughly once, not every refresh.
- New history calls are capped at **12 per refresh** (`MAX_HISTORY_PER_REFRESH`)
  so a busy box ramps up over a few refreshes instead of a single expensive burst.
- Search is limited to a single page (`SEARCH_MAX_PAGES`).

Rough shape: **1 search call + 1 history call per *new* tail** per refresh. A box
with ~N aircraft costs ~N history calls to warm up, then a few calls/refresh as
aircraft rotate through. Keep `BBOX` tight (a single TMA, not a continent) and
check FlightAware's current per-result pricing before running it continuously.
All caps live at the top of `server/src/sources/aeroapi.js`.

## Config

All via `.env` (see `.env.example`): `PORT`, `DATA_SOURCE`, `POLL_INTERVAL_MS`,
`COLOR_MODE`, `SIM_FLEET`, `SIM_SPEED`, `CENTER`, `RADIUS_NM`, `BBOX`,
`OPENSKY_CLIENT_ID/SECRET`, `AEROAPI_KEY`, `SCHEDULE_SOURCE`,
`AVIATIONSTACK_KEY`.
