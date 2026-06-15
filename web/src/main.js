import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { STYLE } from './map-style.js';
import { makePlaneIcon } from './icon.js';
import { FleetStore } from './interpolate.js';
import { connect } from './ws.js';
import { legendFor } from './colors.js';
import { makeAircraftLayer, makeArcLayer, makeAirportLayer, makeRingLayer } from './layers.js';
import { worstCascades, renderLeaderboard } from './leaderboard.js';
import { aggregate, makeDisruptionLayer } from './disruption.js';
import { renderAnalysis, renderLoading } from './analyst-panel.js';
import './style.css';

const MODES = ['genome', 'delay', 'altitude'];

const fleet = new FleetStore();
const icon = makePlaneIcon();
let colorMode = 'genome';
let hasGenome = false;

// flight graph (sim only): id -> leg, and parent -> [children]
const byId = new Map();
const childrenByParent = new Map();
const airportMap = {};

let selectedId = null;
let currentSel = null; // computed selection (arcs, members, lists)

// ── DOM ──
const $ = (id) => document.getElementById(id);
const els = {
  count: $('count'), status: $('status'), badge: $('badge'), source: $('source'),
  legend: $('legend'), legendTitle: $('legend-title'), legendBody: $('legend-body'), toggle: $('toggle'),
  panel: $('panel'), panelContent: $('panel-content'), panelClose: $('panel-close'),
  tooltip: $('tooltip'),
  lbBtn: $('lb-btn'), lb: $('leaderboard'), lbBody: $('leaderboard-body'), lbClose: $('leaderboard-close'),
  disruptBtn: $('disrupt-btn'),
  aiBtn: $('ai-btn'), aiPanel: $('ai-panel'), aiModel: $('ai-model'),
  aiRefresh: $('ai-refresh'), aiClose: $('ai-close'), aiContent: $('ai-content'),
  marksBar: $('marks-bar'),
};

// ── extra features (sim only): leaderboard + airport disruption layer ──
let lbOpen = false;
let disruptOn = false;
let disruptRows = []; // cached aggregate, recomputed once after the graph loads

// ── AI briefing ──
let aiOpen = false;
let aiLoaded = false;

// ── genome markers: pin one or more genomes; every flight carrying them lights up ──
const MARK_PALETTE = [
  [0, 200, 255], [255, 90, 200], [180, 255, 60], [255, 150, 30], [120, 150, 255], [255, 215, 0],
];
const marks = new Map(); // id -> { id, rgb, label }
const marksArray = () => [...marks.values()].map((m) => ({ id: m.id, rgb: m.rgb }));

function affectedCount(id) {
  const seen = new Set();
  (function rec(x) {
    for (const c of childrenByParent.get(x) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      rec(c.id);
    }
  })(id);
  return seen.size + 1; // descendants + the marked flight itself
}

function toggleMark(id) {
  if (marks.has(id)) {
    marks.delete(id);
  } else {
    const used = [...marks.values()].map((m) => m.rgb);
    const rgb =
      MARK_PALETTE.find((c) => !used.some((u) => u[0] === c[0] && u[1] === c[1] && u[2] === c[2])) ||
      MARK_PALETTE[marks.size % MARK_PALETTE.length];
    const leg = byId.get(id);
    marks.set(id, { id, rgb, label: leg ? `${leg.callsign} ${leg.origin}→${leg.dest}` : id });
  }
  renderMarksBar();
  refreshLeaderboard();
  if (currentSel) renderPanel(currentSel);
}
function clearMarks() {
  marks.clear();
  renderMarksBar();
  refreshLeaderboard();
  if (currentSel) renderPanel(currentSel);
}

function renderMarksBar() {
  if (!marks.size) {
    els.marksBar.hidden = true;
    els.marksBar.innerHTML = '';
    return;
  }
  els.marksBar.hidden = false;
  els.marksBar.innerHTML =
    '<span class="marks-label">marked genomes</span>' +
    [...marks.values()]
      .map((m) => {
        const rgb = `rgb(${m.rgb[0]},${m.rgb[1]},${m.rgb[2]})`;
        return (
          `<span class="mark-chip"><i style="background:${rgb}"></i>` +
          `<button class="mark-jump" data-jump="${m.id}">${m.label}</button>` +
          `<span class="mark-n">${affectedCount(m.id)}✈</span>` +
          `<button class="mark-x" data-rm="${m.id}" title="Remove">✕</button></span>`
        );
      })
      .join('') +
    '<button class="mark-clear" data-clear="1">clear</button>';
}
els.marksBar.addEventListener('click', (e) => {
  const jump = e.target.closest('[data-jump]');
  if (jump) return selectFlight(jump.dataset.jump);
  const rm = e.target.closest('[data-rm]');
  if (rm) return toggleMark(rm.dataset.rm);
  if (e.target.closest('[data-clear]')) clearMarks();
});

function refreshLeaderboard() {
  if (!byId.size) return;
  const legs = Array.from(byId.values());
  renderLeaderboard(els.lbBody, worstCascades(legs, childrenByParent), selectFlight, toggleMark, (id) => marks.has(id));
}

// ── map + deck overlay ──
const map = new maplibregl.Map({ container: 'map', style: STYLE, center: [10, 52], zoom: 4.2 });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
const overlay = new MapboxOverlay({ interleaved: false, pickingRadius: 8, layers: [] });
map.addControl(overlay);

// ── server config + flight graph ──
(async () => {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    colorMode = MODES.includes(cfg.colorMode) ? cfg.colorMode : 'genome';
    hasGenome = !!cfg.hasGenome;
    if (cfg.simulated) els.badge.hidden = false;
    // active data source line: attribution string if provided, else the source id
    els.source.textContent = `source: ${cfg.attribution || cfg.dataSource || (cfg.simulated ? 'sim' : 'live')}`;
    els.source.hidden = false;
    // For live point-query sources, open the map where the data is.
    if (Array.isArray(cfg.center) && cfg.center.length === 2) {
      map.jumpTo({ center: [cfg.center[1], cfg.center[0]], zoom: 6.5 });
    }
    for (const a of cfg.airports || []) airportMap[a.code] = a;
    if (hasGenome) {
      const graph = await fetch('/api/graph').then((r) => r.json());
      for (const l of graph) {
        byId.set(l.id, l);
        if (l.parentId) {
          if (!childrenByParent.has(l.parentId)) childrenByParent.set(l.parentId, []);
          childrenByParent.get(l.parentId).push(l);
        }
      }
    }
    setupAnalyst(cfg.analyst);
  } catch {
    /* run with defaults */
  }
  updateLegend();
  initGenomeFeatures();
})();

// The AI briefing needs a flight graph (sim or aeroapi). Populate the model
// selector and reveal the toggle; if no key is configured the panel still shows
// the computed metrics plus a note.
function setupAnalyst(analyst) {
  if (!hasGenome || !analyst) return;
  els.aiModel.innerHTML = (analyst.models || [])
    .map((m) => `<option value="${m}">${m.replace(/^.*\//, '')}</option>`)
    .join('');
  if (analyst.defaultModel) els.aiModel.value = analyst.defaultModel;
  els.aiBtn.hidden = false;
}

// Leaderboard + disruption only make sense with a delay graph (sim mode). In
// live mode (empty byId) the toggles stay hidden so the UI degrades gracefully.
function initGenomeFeatures() {
  if (!byId.size) return;
  const legs = Array.from(byId.values());
  disruptRows = aggregate(legs, airportMap);
  els.lbBtn.hidden = false;
  els.disruptBtn.hidden = disruptRows.length === 0;
  refreshLeaderboard();
}

// ── legend / mode toggle ──
function updateLegend() {
  const l = legendFor(colorMode);
  els.legendTitle.textContent = l.title;
  if (l.kind === 'gradient') {
    els.legendBody.innerHTML =
      `<div class="grad-bar" style="background:${l.css}"></div>` +
      `<div class="grad-labels">${l.labels.map((x) => `<span>${x}</span>`).join('')}</div>`;
  } else {
    els.legendBody.innerHTML = l.items
      .map((it) => `<div class="cat"><i style="background:${it.c}"></i>${it.l}</div>`)
      .join('');
  }
}
els.toggle.addEventListener('click', () => {
  colorMode = MODES[(MODES.indexOf(colorMode) + 1) % MODES.length];
  updateLegend();
});

// ── leaderboard toggle ── (hidden while the cascade panel occupies the right)
function syncLeaderboard() {
  els.lb.hidden = !lbOpen || !els.panel.hidden;
  els.lbBtn.classList.toggle('on', lbOpen);
}
els.lbBtn.addEventListener('click', () => {
  lbOpen = !lbOpen;
  syncLeaderboard();
});
els.lbClose.addEventListener('click', () => {
  lbOpen = false;
  syncLeaderboard();
});

// ── airport disruption layer toggle ──
els.disruptBtn.addEventListener('click', () => {
  disruptOn = !disruptOn;
  els.disruptBtn.classList.toggle('on', disruptOn);
});

// ── AI briefing ──
function openAi() {
  aiOpen = true;
  els.aiPanel.hidden = false;
  els.legend.hidden = true; // the AI panel takes the left column
  els.aiBtn.classList.add('on');
  if (!aiLoaded) runAnalysis(false);
}
function closeAi() {
  aiOpen = false;
  els.aiPanel.hidden = true;
  els.legend.hidden = false;
  els.aiBtn.classList.remove('on');
}
async function runAnalysis(fresh) {
  const model = els.aiModel.value;
  renderLoading(els.aiContent, model.replace(/^.*\//, ''));
  try {
    const url = `/api/analyze?model=${encodeURIComponent(model)}${fresh ? '&fresh=1' : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      els.aiContent.innerHTML = `<div class="ai-note">${data.error}</div>`;
      return;
    }
    aiLoaded = true;
    renderAnalysis(els.aiContent, data, (id) => selectFlight(id));
  } catch (e) {
    els.aiContent.innerHTML = `<div class="ai-note">Analysis failed: ${e.message}</div>`;
  }
}
els.aiBtn.addEventListener('click', () => (aiOpen ? closeAi() : openAi()));
els.aiClose.addEventListener('click', closeAi);
els.aiRefresh.addEventListener('click', () => runAnalysis(true));
els.aiModel.addEventListener('change', () => runAnalysis(true));

// ── stream ──
const api = connect({
  onState: (aircraft) => fleet.ingest(aircraft),
  onStatus: (s) => (els.status.textContent = s),
});
function sendViewport() {
  const b = map.getBounds();
  api.sendViewport([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
}
map.on('load', sendViewport);
map.on('moveend', sendViewport);

// ── selection / cascade tree ──
function computeSelection(id) {
  const node = byId.get(id);
  if (!node) return null;
  const ancestors = [];
  let p = node.parentId;
  let g = 0;
  while (p && byId.has(p) && g++ < 60) {
    ancestors.unshift(byId.get(p));
    p = byId.get(p).parentId;
  }
  const descSet = new Set();
  const desc = [];
  (function rec(x) {
    for (const c of childrenByParent.get(x) || []) {
      if (descSet.has(c.id)) continue;
      descSet.add(c.id);
      desc.push(c);
      rec(c.id);
    }
  })(id);
  const memberSet = new Set([id, ...ancestors.map((a) => a.id), ...descSet]);
  const A = (code) => airportMap[code];
  const arc = (l, role) =>
    A(l.origin) && A(l.dest)
      ? { source: [A(l.origin).lon, A(l.origin).lat], target: [A(l.dest).lon, A(l.dest).lat], role }
      : null;
  const arcs = [
    ...ancestors.map((a) => arc(a, 'ancestor')),
    arc(node, 'self'),
    ...desc.map((d) => arc(d, 'descendant')),
  ].filter(Boolean);
  const codes = new Set();
  [node, ...ancestors, ...desc].forEach((l) => {
    codes.add(l.origin);
    codes.add(l.dest);
  });
  const airportPts = [...codes].filter(A).map((c) => ({ position: [A(c).lon, A(c).lat], code: c }));
  return { node, ancestors, desc, memberSet, arcs, airportPts };
}

function selectFlight(id) {
  selectedId = id;
  currentSel = computeSelection(id);
  if (!currentSel) {
    els.panel.hidden = true;
    syncLeaderboard();
    return;
  }
  renderPanel(currentSel);
  els.panel.hidden = false;
  syncLeaderboard();
}
function clearSelection() {
  selectedId = null;
  currentSel = null;
  els.panel.hidden = true;
  syncLeaderboard();
}

const cls = (l) =>
  l.delayMin <= 5 ? 'ok' : (l.primaryDelayMin || 0) >= (l.reactionaryDelayMin || 0) ? 'cause' : 'victim';

function treeHtml(id) {
  const children = childrenByParent.get(id) || [];
  if (!children.length) return '';
  return (
    '<ul class="tree">' +
    children
      .map(
        (c) =>
          `<li><span class="node ${cls(c)}" data-id="${c.id}">${c.callsign} ` +
          `<em>${c.origin}→${c.dest}</em> +${c.delayMin}m <small>${c.causeKind || ''}</small></span>` +
          treeHtml(c.id) +
          '</li>'
      )
      .join('') +
    '</ul>'
  );
}

function renderPanel(sel) {
  const n = sel.node;
  const causedBy = sel.ancestors.length
    ? sel.ancestors
        .map((a) => `<span class="node ${cls(a)}" data-id="${a.id}">${a.callsign} <em>${a.origin}→${a.dest}</em></span>`)
        .join('<span class="hop"> → </span>')
    : n.primaryDelayMin >= 5
    ? '<span class="muted">Root cause — its delay started here.</span>'
    : '<span class="muted">On time / not in a delay chain.</span>';

  const tree = sel.desc.length
    ? treeHtml(n.id)
    : '<span class="muted">No downstream flights affected.</span>';

  const marked = marks.has(n.id);
  els.panelContent.innerHTML =
    `<div class="p-cs">${n.callsign}</div>` +
    `<div class="p-route">${n.origin} → ${n.dest}</div>` +
    `<div class="p-stat">` +
    `<div><div class="k">Delay</div><div class="v">${n.delayMin}m</div></div>` +
    `<div><div class="k">Reactionary</div><div class="v">${n.reactionaryDelayMin || 0}m</div></div>` +
    `<div><div class="k">Blast radius</div><div class="v">${n.blastRadius || 0}</div></div>` +
    `</div>` +
    `<button class="mark-btn${marked ? ' on' : ''}" data-mark-genome="${n.id}">${
      marked ? '✓ Genome marked' : '⚑ Mark this genome'
    }</button>` +
    `<div class="p-sec-title">Caused by</div><div class="chain">${causedBy}</div>` +
    `<div class="p-sec-title">Knock-on cascade${sel.desc.length ? ` (${sel.desc.length} flights)` : ''}</div>${tree}`;
}

// panel interactions: mark the genome, or reselect a node in the tree
els.panelContent.addEventListener('click', (e) => {
  const mb = e.target.closest('[data-mark-genome]');
  if (mb) return toggleMark(mb.dataset.markGenome);
  const node = e.target.closest('.node[data-id]');
  if (node) selectFlight(node.dataset.id);
});
els.panelClose.addEventListener('click', clearSelection);
window.addEventListener('keydown', (e) => e.key === 'Escape' && clearSelection());

// ── interaction handlers for deck ──
function onAircraftClick(info) {
  if (info.object && byId.has(info.object.id)) selectFlight(info.object.id);
}
function onHover(info) {
  if (!info.object) {
    els.tooltip.hidden = true;
    return;
  }
  const o = info.object;
  const ft = o.alt != null ? Math.round(o.alt * 3.28084).toLocaleString() : '—';
  const kn = o.speed ? Math.round(o.speed * 1.94384) : 0;
  const delay = o.delayMin == null ? '' : o.delayMin <= 0 ? ' · on time' : ` · +${o.delayMin}m`;
  els.tooltip.hidden = false;
  els.tooltip.style.left = info.x + 'px';
  els.tooltip.style.top = info.y + 'px';
  els.tooltip.innerHTML = `<span class="t-cs">${o.callsign || o.id}</span>${delay}<br><span class="t-d">${ft} ft · ${kn} kn</span>`;
}
function onDisruptionHover(info) {
  if (!info.object) {
    els.tooltip.hidden = true;
    return;
  }
  const o = info.object;
  els.tooltip.hidden = false;
  els.tooltip.style.left = info.x + 'px';
  els.tooltip.style.top = info.y + 'px';
  els.tooltip.innerHTML =
    `<span class="t-cs">${o.code}</span> · ${o.name}<br>` +
    `<span class="t-d">+${o.originatedDelayMin}m originated · ${o.delayedDepartures}/${o.totalDepartures} delayed dep</span>`;
}

// ── render loop ──
function frame() {
  const now = performance.now();
  const data = fleet.snapshot(now);
  const liveById = new Map(data.map((d) => [d.id, d]));
  const layers = [];
  const selActive = !!currentSel;
  if (selActive) {
    layers.push(makeArcLayer(currentSel.arcs));
    layers.push(makeAirportLayer(currentSel.airportPts));
    const members = [...currentSel.memberSet].map((id) => liveById.get(id)).filter(Boolean);
    layers.push(makeRingLayer(members));
  }
  if (disruptOn && disruptRows.length) {
    layers.push(makeDisruptionLayer(disruptRows, onDisruptionHover));
  }
  layers.push(
    makeAircraftLayer({
      data,
      icon,
      mode: colorMode,
      selActive,
      memberSet: currentSel?.memberSet,
      marks: marksArray(),
      onClick: onAircraftClick,
      onHover,
    })
  );
  overlay.setProps({ layers });
  els.count.textContent = data.length.toLocaleString();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
