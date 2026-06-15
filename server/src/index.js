import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { AircraftState } from './state.js';
import { getSource } from './sources/index.js';
import { getEnrichment } from './enrichment/index.js';
import { startPoller } from './poller.js';
import { analyze } from './analyst.js';
import { haversineKm } from './sim/geo.js';

// Live sources query a point/bbox region; make that region follow the client's
// map viewport so panning to a new area fetches that area's aircraft.
function updateQueryRegion(bounds) {
  const [w, s, e, n] = bounds;
  config.center = [(s + n) / 2, (w + e) / 2]; // [lat, lon]
  config.bbox = [w, s, e, n];
  const km = haversineKm([config.center[1], config.center[0]], [w, n]); // centre→corner
  config.radiusNm = Math.min(250, Math.max(20, Math.round(km / 1.852)));
}

// Curated OpenRouter models offered in the UI selector (the configured default
// is always included). Any OpenRouter model id also works via ?model=.
const ANALYST_MODELS = [
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.5-pro',
  'openai/gpt-5',
];

const state = new AircraftState();
const source = getSource(config.dataSource);
if (source.init) source.init(config);

// Sources that compute their own delay + genome don't need (and must not be
// clobbered by) the external schedule enrichment.
const hasOwnGenome = source.meta ? !!source.meta().hasGenome : false;
const enrichment = hasOwnGenome ? null : getEnrichment(config.scheduleSource);

// The configured start-center for the map's initial view — kept stable even as
// the live query region (config.center/bbox) follows the viewport afterwards.
const initialCenter = config.dataSource === 'sim' ? null : [...config.center];

const FIELDS = [
  'id', 'hex', 'callsign', 'lat', 'lon', 'track', 'speed', 'alt', 'onGround',
  'origin', 'dest', 'delayMin', 'primaryDelayMin', 'reactionaryDelayMin',
  'genome', 'rootId', 'parentId', 'blastRadius', 'pax',
];

function serialize(a) {
  const o = {};
  for (const k of FIELDS) if (a[k] !== undefined) o[k] = a[k];
  return o;
}

const fastify = Fastify({ logger: false });
await fastify.register(websocket);

const clients = new Set(); // { socket, bounds }

function broadcast() {
  const t = Date.now();
  for (const c of clients) {
    if (c.socket.readyState !== 1) continue;
    const ac = state.inBounds(c.bounds).map(serialize);
    c.socket.send(JSON.stringify({ type: 'state', t, aircraft: ac }));
  }
}

fastify.register(async (f) => {
  f.get('/ws', { websocket: true }, (connection) => {
    const socket = connection.socket ?? connection; // v8 vs v11 compatibility
    const client = { socket, bounds: null };
    clients.add(client);
    socket.send(JSON.stringify({ type: 'state', t: Date.now(), aircraft: state.all().map(serialize) }));
    socket.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'viewport' && Array.isArray(m.bounds)) {
          client.bounds = m.bounds;
          if (config.dataSource !== 'sim') updateQueryRegion(m.bounds);
        }
      } catch {
        /* ignore */
      }
    });
    socket.on('close', () => clients.delete(client));
  });
});

fastify.get('/api/config', async () => {
  const meta = source.meta ? source.meta() : {};
  return {
    colorMode: config.colorMode,
    dataSource: config.dataSource,
    simulated: config.dataSource === 'sim' || config.dataSource === 'livesim',
    scheduleSource: config.scheduleSource,
    airports: meta.airports || [],
    hasGenome: !!meta.hasGenome,
    attribution: meta.attribution || null,
    // [lat, lon] stable focus point for the map's initial view (the live query
    // region follows the viewport afterwards).
    center: initialCenter,
    analyst: {
      enabled: !!config.openrouterKey,
      defaultModel: config.analystModel,
      models: [...new Set([config.analystModel, ...ANALYST_MODELS])],
    },
  };
});

fastify.get('/api/graph', async () => (source.graph ? source.graph() : []));

fastify.get('/api/analyze', async (req, reply) => {
  if (!source.graph) return reply.code(400).send({ error: 'No flight graph for this data source (needs sim or aeroapi).' });
  const graph = source.graph();
  if (!graph.length) return reply.code(503).send({ error: 'No flights yet — try again in a moment.' });
  const { model, fresh } = req.query || {};
  const cleanModel = typeof model === 'string' && /^[\w.\-]+\/[\w.\-:]+$/.test(model) ? model : undefined;
  return analyze(graph, config, { model: cleanModel, fresh: fresh === '1' || fresh === 'true' });
});

fastify.get('/api/health', async () => ({
  ok: true,
  source: config.dataSource,
  count: state.all().length,
}));

startPoller({
  source,
  enrichment,
  state,
  cfg: config,
  onUpdate: broadcast,
  replace: config.dataSource === 'sim',
});

await fastify.listen({ port: config.port, host: '0.0.0.0' });
console.log(`flightgenom server :${config.port}  source=${config.dataSource}  genome=${hasOwnGenome}`);
