// AI network analyst. Principle: compute the hard numbers in code (exact, cheap,
// no hallucination), then hand a compact digest to an LLM for the narrative,
// conclusions, predictions, and "narrow sensitive point" interpretation.
import { AIRPORT_MAP } from './sim/airports.js';

const MIN = 60000;

// ── structural metrics from the flight graph (pure) ──
export function computeMetrics(graph, nowMs) {
  const byId = new Map(graph.map((l) => [l.id, l]));
  const childrenByParent = new Map();
  for (const l of graph) {
    if (l.parentId) {
      if (!childrenByParent.has(l.parentId)) childrenByParent.set(l.parentId, []);
      childrenByParent.get(l.parentId).push(l);
    }
  }
  const descendants = (id) => {
    const out = [];
    const seen = new Set();
    const stack = [...(childrenByParent.get(id) || [])];
    while (stack.length) {
      const n = stack.pop();
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
      stack.push(...(childrenByParent.get(n.id) || []));
    }
    return out;
  };

  const delayed = graph.filter((l) => l.delayMin > 15);
  const totalDelayMin = graph.reduce((s, l) => s + Math.max(0, l.delayMin || 0), 0);
  const paxOf = (l) => l.pax || 0;
  const paxAffected = (id) => descendants(id).reduce((s, d) => s + paxOf(d), paxOf(byId.get(id)));

  const summary = {
    totalFlights: graph.length,
    airborneNow: graph.filter((l) => nowMs >= l.actDep && nowMs <= l.actArr).length,
    delayedOver15: delayed.length,
    onTimePct: graph.length ? Math.round(100 * (1 - delayed.length / graph.length)) : 100,
    totalDelayMin,
    worstSingleDelayMin: graph.reduce((m, l) => Math.max(m, l.delayMin || 0), 0),
    passengersDelayed: delayed.reduce((s, l) => s + paxOf(l), 0),
  };

  const topPropagators = graph
    .filter((l) => (l.blastRadius || 0) > 0)
    .sort((a, b) => b.blastRadius - a.blastRadius || b.delayMin - a.delayMin)
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      callsign: l.callsign,
      route: `${l.origin}→${l.dest}`,
      delayMin: l.delayMin,
      isRoot: l.rootId === l.id,
      blastRadius: l.blastRadius,
      downstreamDelayMin: descendants(l.id).reduce((s, d) => s + Math.max(0, d.delayMin || 0), 0),
      passengersAffected: paxAffected(l.id),
    }));

  // per-airport disruption + propagation leverage
  const apt = new Map();
  const bump = (code) =>
    apt.get(code) || apt.set(code, { code, delaysOriginatedMin: 0, delayedDepartures: 0, propagationReach: 0 }).get(code);
  for (const l of graph) {
    const a = bump(l.origin);
    a.delaysOriginatedMin += Math.max(0, l.primaryDelayMin || 0);
    if (l.delayMin > 15) a.delayedDepartures += 1;
    a.propagationReach += l.blastRadius || 0;
  }
  const sensitiveAirports = [...apt.values()]
    .filter((a) => a.propagationReach > 0 || a.delaysOriginatedMin > 0)
    .map((a) => ({ ...a, name: AIRPORT_MAP[a.code]?.name || a.code, delaysOriginatedMin: Math.round(a.delaysOriginatedMin) }))
    .sort((a, b) => b.propagationReach - a.propagationReach || b.delaysOriginatedMin - a.delaysOriginatedMin)
    .slice(0, 8);

  // forward-looking: flights not yet departed that will be delayed
  const upcomingAtRisk = graph
    .filter((l) => l.actDep > nowMs && l.delayMin > 15)
    .sort((a, b) => a.actDep - b.actDep)
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      callsign: l.callsign,
      route: `${l.origin}→${l.dest}`,
      expectedDelayMin: l.delayMin,
      departsInMin: Math.max(0, Math.round((l.schedDep - nowMs) / MIN)),
      causedBy: l.parentId ? byId.get(l.parentId)?.callsign : null,
      causeKind: l.causeKind || null,
    }));

  return { summary, topPropagators, sensitiveAirports, upcomingAtRisk };
}

// ── LLM synthesis via OpenRouter ──
const SYSTEM = `You are the duty operations analyst for a flight network's control center. You receive COMPUTED metrics that are already accurate — never recompute or invent numbers, only interpret them. Be concrete: reference specific callsigns and airport codes from the data. A "narrow sensitive point" is a single flight or airport whose disruption has outsized downstream leverage (a chokepoint / single point of failure). Where it sharpens the point, quantify impact in PASSENGERS (passengersAffected / passengersDelayed are provided). Reply with STRICT JSON only, no markdown.`;

function userPrompt(metrics) {
  return `Metrics for the current network state:
${JSON.stringify(metrics, null, 1)}

Return JSON with exactly these fields:
{
  "summary": "2-3 sentence operational headline naming the dominant delay driver",
  "conclusions": ["3-5 short insights, each referencing specific flights/airports"],
  "sensitivePoints": ["2-4 chokepoints / single points of failure to watch, by airport code or callsign, with why"],
  "predictions": ["2-4 forward-looking calls on which flights/airports will worsen next"]
}`;
}

function extractJson(text) {
  if (!text) return null;
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

export async function runLlm(metrics, cfg) {
  if (!cfg.openrouterKey) {
    return { available: false, note: 'Set OPENROUTER_API_KEY to enable the AI briefing (metrics shown are computed locally).' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${cfg.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5190',
        'X-Title': 'flightgenom',
      },
      body: JSON.stringify({
        model: cfg.analystModel,
        temperature: 0.4,
        // Headroom: reasoning models (e.g. Opus 4.8) spend output tokens on
        // thinking before the JSON, so a low cap truncates the answer.
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt(metrics) },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { available: false, note: `OpenRouter ${res.status}: ${body.slice(0, 160)}` };
    }
    const j = await res.json();
    const content = j.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    if (!parsed) return { available: false, note: 'Model did not return parseable JSON.' };
    return { available: true, ...parsed };
  } catch (e) {
    return { available: false, note: `Analyst call failed: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ── cached entry point used by the route (keyed by model) ──
const cache = new Map(); // model -> { at, data }

export async function analyze(graph, cfg, { fresh = false, model } = {}) {
  const nowMs = Date.now();
  const useModel = model || cfg.analystModel;
  const hit = cache.get(useModel);
  if (!fresh && hit && nowMs - hit.at < 60000) return hit.data;
  const metrics = computeMetrics(graph, nowMs);
  const ai = await runLlm(metrics, { ...cfg, analystModel: useModel });
  const data = { generatedAt: nowMs, model: useModel, metrics, ai };
  cache.set(useModel, { at: nowMs, data });
  return data;
}
