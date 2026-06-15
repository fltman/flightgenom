// "Worst cascades today" — rank the root-cause flights whose delay rippled the
// furthest. Pure: takes the graph legs plus the parent→children map (both built
// in main.js) and returns the top N roots, ranked by blast radius, tie-broken by
// total downstream delay (sum of delayMin over every descendant).

// Walk a leg's descendants via the children map and sum their delay minutes.
function downstreamDelay(id, childrenByParent) {
  let sum = 0;
  const seen = new Set();
  (function rec(x) {
    for (const c of childrenByParent.get(x) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      sum += c.delayMin || 0;
      rec(c.id);
    }
  })(id);
  return sum;
}

// Passengers affected = this flight's pax + every downstream flight's pax.
function affectedPax(leg, childrenByParent) {
  let sum = leg.pax || 0;
  const seen = new Set();
  (function rec(x) {
    for (const c of childrenByParent.get(x) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      sum += c.pax || 0;
      rec(c.id);
    }
  })(leg.id);
  return sum;
}

// A leg is a root cause if it's its own root (or has no parent) and it actually
// started a delay of its own.
function isRoot(l) {
  const ownRoot = l.rootId ? l.rootId === l.id : l.parentId == null;
  return ownRoot && (l.delayMin || 0) > 5 && (l.primaryDelayMin || 0) >= 5;
}

export function worstCascades(legs, childrenByParent, limit = 8) {
  return legs
    .filter(isRoot)
    .map((l) => ({
      id: l.id,
      callsign: l.callsign,
      origin: l.origin,
      dest: l.dest,
      delayMin: l.delayMin || 0,
      blastRadius: l.blastRadius || 0,
      downstreamDelay: downstreamDelay(l.id, childrenByParent),
      pax: affectedPax(l, childrenByParent),
    }))
    .sort((a, b) => b.blastRadius - a.blastRadius || b.downstreamDelay - a.downstreamDelay)
    .slice(0, limit);
}

// Render the rows into the leaderboard panel body. onPick(id) jumps to a flight's
// cascade; onMark(id) toggles a genome marker; isMarked(id) reflects mark state.
export function renderLeaderboard(bodyEl, rows, onPick, onMark, isMarked = () => false) {
  if (!rows.length) {
    bodyEl.innerHTML = '<div class="lb-empty">No cascading delays right now.</div>';
    return;
  }
  bodyEl.innerHTML = rows
    .map(
      (r, i) =>
        `<div class="lb-row" data-id="${r.id}">` +
        `<span class="lb-rank">${i + 1}</span>` +
        `<button class="lb-pick" data-pick="${r.id}">` +
        `<span class="lb-cs">${r.callsign}</span>` +
        `<span class="lb-route">${r.origin} → ${r.dest}</span>` +
        `</button>` +
        `<span class="lb-meta">` +
        `<span class="lb-delay">+${r.delayMin}m</span>` +
        `<span class="lb-blast">${r.blastRadius}✈ · ${r.pax.toLocaleString()}p</span>` +
        `</span>` +
        `<button class="lb-mark${isMarked(r.id) ? ' on' : ''}" data-mark="${r.id}" title="Mark this genome">⚑</button>` +
        `</div>`
    )
    .join('');
  bodyEl.onclick = (e) => {
    const mark = e.target.closest('[data-mark]');
    if (mark) return onMark(mark.dataset.mark);
    const pick = e.target.closest('[data-pick]');
    if (pick) onPick(pick.dataset.pick);
  };
}
