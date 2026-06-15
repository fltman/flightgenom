// Interactive cascade diagram via Mermaid (lazy-loaded). Renders the full
// cascade family (rooted at the selected flight's root) as a top-down node-link
// graph: nodes colored on-time / cause / victim, edges labelled with the
// propagated minutes, and every node clickable to navigate. "Full impact" view.
let mermaidPromise = null;
async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose', // allow click → window callback
        theme: 'dark',
        flowchart: { htmlLabels: true, curve: 'basis', nodeSpacing: 26, rankSpacing: 42 },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

const nid = (id) => 'n' + String(id).replace(/[^a-zA-Z0-9_]/g, '');
const esc = (s) => String(s == null ? '' : s).replace(/["\n]/g, ' ');

function classOf(l) {
  if ((l.delayMin || 0) <= 5) return 'ok';
  return (l.primaryDelayMin || 0) >= (l.reactionaryDelayMin || 0) ? 'cause' : 'victim';
}

// Build the Mermaid definition + some stats for the cascade family of `selectedId`.
export function buildDef(selectedId, byId, childrenByParent) {
  const node = byId.get(selectedId);
  if (!node) return null;
  const rootId = byId.has(node.rootId) ? node.rootId : node.id;
  const fam = [];
  const seen = new Set();
  (function rec(x) {
    if (seen.has(x) || !byId.has(x)) return;
    seen.add(x);
    fam.push(x);
    for (const c of childrenByParent.get(x) || []) rec(c.id);
  })(rootId);
  if (!seen.has(selectedId)) {
    seen.clear();
    fam.length = 0;
    fam.push(selectedId);
    seen.add(selectedId);
  }

  // Aggregated passengers per node = its own pax + every downstream descendant's
  // pax. This is what shows the *effect*: a root reports the whole cascade.
  const subPax = new Map();
  const subtreePax = (id) => {
    if (subPax.has(id)) return subPax.get(id);
    const l = byId.get(id);
    let s = l && seen.has(id) ? l.pax || 0 : 0;
    for (const c of childrenByParent.get(id) || []) if (seen.has(c.id)) s += subtreePax(c.id);
    subPax.set(id, s);
    return s;
  };

  const lines = ['graph TD'];
  const nidToId = {};
  for (const id of fam) {
    const l = byId.get(id);
    nidToId[nid(id)] = id;
    const sub = subtreePax(id);
    const own = l.pax || 0;
    // Always show own passengers; add the aggregate (own + all downstream) when
    // this node has descendants — the aggregate INCLUDES the flight's own pax.
    let extra = `<br/>${own}p on board`;
    if (sub !== own) extra += `<br/>Σ ${sub.toLocaleString()}p affected`;
    lines.push(
      `${nid(id)}["${esc(l.callsign)}<br/>${esc(l.origin)}→${esc(l.dest)} +${l.delayMin}m${extra}"]:::${classOf(l)}`
    );
  }
  const pax = subtreePax(seen.has(rootId) ? rootId : selectedId);
  for (const id of fam) {
    const l = byId.get(id);
    if (l.parentId && seen.has(l.parentId)) {
      const lbl = `+${l.reactionaryDelayMin || 0}m ${l.causeKind || ''}`.trim();
      lines.push(`${nid(l.parentId)} -->|"${lbl}"| ${nid(id)}`);
    }
  }
  lines.push('classDef ok fill:#10301c,stroke:#3cc85a,color:#dffbe8;');
  lines.push('classDef cause fill:#2a1640,stroke:#b45aff,color:#efe3ff;');
  lines.push('classDef victim fill:#3a1316,stroke:#e83c32,color:#ffe2df;');
  lines.push(`style ${nid(selectedId)} stroke:#ffffff,stroke-width:4px;`);

  return { def: lines.join('\n'), count: fam.length, pax, nidToId };
}

let renderSeq = 0;
export async function renderInto(container, def) {
  const mermaid = await getMermaid();
  const { svg, bindFunctions } = await mermaid.render('fgdiagram' + renderSeq++, def);
  container.innerHTML = svg;
  if (bindFunctions) bindFunctions(container);
}
