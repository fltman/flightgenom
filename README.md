# flightgenom ✈️🧬

[![Support me on Patreon](https://img.shields.io/badge/Patreon-Support%20my%20work-FF424D?style=flat&logo=patreon&logoColor=white)](https://www.patreon.com/AndersBjarby)

**A realtime flight map — like Flightradar24 — that tracks the _delay genome_.**

Every flight that's running late inherits the IDs of the upstream flights that
_caused_ its delay. So you can take any delayed aircraft, trace its delay back to
"patient zero", and watch the **cascade tree** of everything that one disruption
went on to wreck across the network.

It runs out of the box on a **synthetic airline network** (zero setup), on
**real live ADS-B aircraft with a simulated genome** (free), or — with a paid
schedule API — on **real flights with a real genome**.

> Live demo data, the genome math, and an AI ops-analyst — all in one small
> Node + browser app.

---

## What is a "delay genome"?

Aircraft fly leg after leg all day: `A→B→C→D`. Delay propagates along two kinds of
causal edge:

- **Rotation** — the _same aircraft_ lands late, so its next departure is late too.
- **Connection** — a late arrival holds up _other aircraft_ waiting for its
  passengers/crew. This is what turns a chain into a **branching tree**.

Each flight accumulates the ordered list of ancestors whose delay knocked on into
it — its **genome**. From that you get, for free:

| Concept | Meaning |
|---|---|
| **Root cause** (`rootId`) | the original disruption — "patient zero" |
| **Reactionary delay** | the portion of a delay inherited from upstream |
| **Blast radius** | how many downstream flights one flight infected |
| **Cascade tree** | the full branching map of who-delayed-whom |

---

## Quick start

```bash
npm install
npm run dev
```

- Web UI → http://localhost:5190
- API / WebSocket → http://localhost:8099

Defaults to the **`sim`** source — a synthetic European network with injected
disruptions cascading through real rotation + connection logic. The genome
algorithm is real; only the flights are synthetic (the UI shows a **SIMULATED**
badge). Copy `.env.example` → `.env` to change anything.

### Three ways to run it

| Want | Set in `.env` | Cost |
|---|---|---|
| Full genome demo, zero setup | `DATA_SOURCE=sim` | free |
| **Real planes + simulated genome** | `DATA_SOURCE=livesim` | **free** |
| Real planes, no genome (just positions) | `DATA_SOURCE=adsblol` | free |
| Real planes **with a real genome** | `DATA_SOURCE=aeroapi` + key | paid |

---

## Features

- **Live map** — MapLibre GL basemap + deck.gl WebGL aircraft, rotated by heading,
  **dead-reckoned on the client** so motion is smooth between server snapshots.
- **Three color modes** (toggle, bottom-left):
  - **genome** — 🟢 on time · 🟣 delay origin (cause) · 🔴 knock-on (victim)
  - **delay** — green→red by minutes late
  - **altitude** — ground→cruise
- **Click → cascade tree** — any flight opens a side panel: **Caused by** (the
  upstream chain) and the **Knock-on cascade** (the branching downstream tree).
  The map draws orange arcs upstream and red arcs to every flight it delayed.
- **Interactive cascade diagram** — a Mermaid node-link graph of the whole
  cascade family: nodes colored cause/victim, edges labeled with the propagated
  minutes, every node clickable to navigate.
- **Passenger impact** — each flight carries an estimated passenger count (from
  aircraft type when known). The cascade diagram and panel show each flight's
  own pax **and** the aggregated **Σ passengers affected** down its subtree (own
  included). A headline HUD stat sums it network-wide: **passengers delayed** and
  **person-years of human time lost** (Σ pax × delay).
- **Worst cascades leaderboard** — the root-cause flights whose delay rippled the
  furthest (flights + passengers affected); click to jump to a cascade.
- **Airport disruption heatmap** — graded bubbles showing _where_ delay is created.
- **Genome marking** — pin one or more genomes (⚑); every flight carrying them
  lights up in that genome's color and the rest dim. Mark several to compare
  cascades side by side.
- **AI briefing** — an LLM (via OpenRouter, model switchable in the panel) reads
  locally-computed metrics and returns a plain-English summary, conclusions, the
  **narrow sensitive points** (network chokepoints), and predictions. The hard
  numbers are computed in code — the model only interprets, so it can't hallucinate
  the stats.

---

## Real planes, simulated genome (`livesim`)

The sweet spot if you don't want to pay for a schedule API: **real ADS-B
positions with a believable fake cascade laid over them**, so the whole genome UI
works on real aircraft for €0.

```bash
DATA_SOURCE=livesim
LIVESIM_FEED=airplaneslive   # adsblol | airplaneslive | adsbfi
CENTER=40.71,-74.0           # lat,lon — the map opens here (e.g. New York)
RADIUS_NM=250
```

Each real plane (keyed by ICAO24 hex) gets **sticky** synthetic attributes: a
plausible origin/dest derived from its _actual heading_ (nearest airport
behind/ahead), a pseudo-delay, and causal edges fabricated at shared airports
(more-delayed → less-delayed, acyclic, branchy). It's a simulation of the
_effect_ — not real causality — and the badge says so.

---

## Architecture

```
 data source ──poll──▶ in-memory state ──▶ WebSocket fan-out ──▶ browser
 (sim │ livesim │        (+ delay/genome)    (viewport-filtered)   • deck.gl + MapLibre
  adsb.lol │ aeroapi)                                              • client dead-reckoning
                                                                   • cascade arcs / tree
        every source emits the SAME shape ───────────────────────▶ /api/graph powers the
        { id, callsign, origin, dest, delayMin,                     leaderboard, heatmap,
          genome[], parentId, rootId, blastRadius, … }              marking, and AI briefing
```

- **Backend** — Fastify + `@fastify/websocket`. Polls the source, holds aircraft
  state in memory, streams only the aircraft inside each client's viewport, and
  exposes `/api/graph` (full flight graph), `/api/analyze` (AI briefing), and
  `/api/config`. The genome propagation is one pure module
  (`server/src/genome/propagate.js`) shared by every genome-capable source.
- **Frontend** — MapLibre GL + deck.gl `IconLayer` (planes) / `ArcLayer`
  (cascade). No build step on the server; Vite for the web app.

---

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `DATA_SOURCE` | `sim` | `sim` · `livesim` · `adsblol` · `adsbfi` · `airplaneslive` · `opensky` · `aeroapi` |
| `COLOR_MODE` | `genome` | `genome` · `delay` · `altitude` |
| `CENTER` / `RADIUS_NM` | Stockholm / 250 | focus point for live point-query feeds (≤250 NM) |
| `LIVESIM_FEED` | `airplaneslive` | which ADS-B feed `livesim` uses for positions |
| `BBOX` | Europe box | `W,S,E,N` for `opensky` / `aeroapi` |
| `OPENROUTER_API_KEY` | — | enables the AI briefing |
| `ANALYST_MODEL` | `anthropic/claude-opus-4.8` | also switchable live in the UI |
| `AEROAPI_KEY` | — | enables the real-genome `aeroapi` source |

---

## Choosing a real data source

Live ADS-B gives you _positions_ but **no schedule/delay data** — a real genome
needs scheduled-vs-actual times **and** each aircraft's rotation. From a deep,
source-verified comparison (Europe-first):

| Source | Rotation by tail? | Delay data | Positions | Cost | Public-redisplay licence |
|---|---|---|---|---|---|
| **AeroDataBox** | ✅ search by reg/ICAO24/callsign, 1 call | flight + airport stats | — | **~$150/mo** | via RapidAPI terms |
| **FlightAware AeroAPI** | ✅ by ident/registration | ✅ best (full OOOI gate+runway) | ✅ | $$$ (per result set) | commercial OK (paid) |
| **OpenSky** | ✅ by ICAO24 (≤2 days) | ❌ none | `/states/all` | free | **research/non-profit only** |
| **Cirium / FlightStats** | ⚠️ (Connections ≠ same tail) | ✅ canonical methodology | ✅ Flight Track | enterprise | enterprise |
| **adsb.lol** | — (positions) | — | ✅ | free | **ODbL** (attribution + share-alike) → OK public |
| adsb.fi / airplanes.live | — | — | ✅ | free | non-commercial |

**Verdict:** the cheapest path to a _real_ genome is **AeroDataBox** (query each
tail's legs by registration/ICAO24, then propagate), not the pricier AeroAPI.
`flightgenom` ships an `aeroapi` adapter as the premium option.

**Caveat (all sources):** these feeds only expose **rotation** edges (same tail,
leg→leg). Crew, passenger-connection and slot/curfew edges aren't observable, so a
real-data genome is a _lower bound_ on the true cascade. The `sim` source models
both edge types to show the full concept.

---

## Project layout

```
server/src/
  index.js            Fastify + WebSocket + /api/{config,graph,analyze,health}
  sources/            sim · livesim · readsb (adsb.lol/fi/airplanes.live) · opensky · aeroapi
  genome/propagate.js the one pure genome-propagation module (shared)
  sim/                engine (synthetic network) · geo · airports · airports-world
  analyst.js          metrics + OpenRouter call for the AI briefing
web/src/
  main.js  layers.js  interpolate.js  colors.js  icon.js
  leaderboard.js  disruption.js  analyst-panel.js
```

---

## Honesty & caveats

- The **SIMULATED** badge means delays/genome are synthetic (`sim` and `livesim`);
  positions in `livesim` are real, the cascade is fabricated.
- For a public deployment: self-host basemap tiles (e.g. Protomaps PMTiles) rather
  than the keyless CARTO tiles used here, honour each feed's attribution/licence,
  and note that "Flightradar24" is a trademark — don't imply affiliation.

## Roadmap

- Real genome on live European flights via AeroDataBox (rotation by registration).
- Time-scrubbing / playback of a day's cascades.
- Persisted "worst cascades" history and alerting.

---

Built with [Claude Code](https://claude.com/claude-code). Aircraft data ©
OpenStreetMap/CARTO (basemap) and the respective ADS-B feeders.
