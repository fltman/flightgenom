// Pure delay-genome propagation, extracted from SimEngine so it can run on ANY
// set of legs — synthetic (sim) OR real (e.g. AeroAPI rotations). Given an array
// of legs with their schedule + injected-primary delay + causal links (prev /
// conn), it computes the actual times, the delay breakdown, the binding cause,
// the genome (ordered ancestor list, root first), and each leg's blast radius.
//
// INPUT — each leg must carry:
//   id            unique string
//   callsign      string (used in genome entries)
//   origin, dest  airport codes (used in genome entries)
//   schedDep      scheduled departure, epoch ms
//   schedArr      scheduled arrival, epoch ms
//   blockMs       scheduled block time (schedArr - schedDep), ms
//   primaryInjMin primary (own) delay injected at the gate, minutes
//   prev          the SAME aircraft's previous leg object (rotation edge) or null
//   conn          a DIFFERENT aircraft's inbound leg this dep waits for, or null
//
// OUTPUT — mutates each leg in place, setting exactly:
//   actDep, actArr, delayMin, depDelayMin, reactionaryDelayMin,
//   primaryDelayMin, parentId, causeKind, rootId, genome, blastRadius
//
// The logic is byte-for-byte the same as the original SimEngine._propagate() +
// _blast(); kept here as the single source of truth.

const MIN = 60 * 1000;
export const MIN_TURN_MS = 40 * MIN; // min ground time between two legs of one aircraft
export const MIN_CONNECT_MS = 30 * MIN; // min time a waited-for connection needs after arrival

export function propagateGenome(legs) {
  // Process in departure-time order so every cause (rotation prev or
  // connection inbound) is resolved before the leg that depends on it.
  const sorted = [...legs].sort((a, b) => a.schedDep - b.schedDep);
  for (const leg of sorted) {
    const primary = leg.primaryInjMin;
    const primaryReady = leg.schedDep + primary * MIN;
    const rotReady = leg.prev ? leg.prev.actArr + MIN_TURN_MS : -Infinity;
    const connReady = leg.conn ? leg.conn.actArr + MIN_CONNECT_MS : -Infinity;
    const actDep = Math.max(primaryReady, rotReady, connReady, leg.schedDep);

    // Binding external cause = whichever pushed the departure latest.
    let cause = null;
    let causeReady = primaryReady;
    let causeKind = null;
    if (rotReady > causeReady) {
      cause = leg.prev;
      causeReady = rotReady;
      causeKind = 'rotation';
    }
    if (connReady > causeReady) {
      cause = leg.conn;
      causeReady = connReady;
      causeKind = 'connection';
    }

    const depDelay = (actDep - leg.schedDep) / MIN;
    const reactionary = cause ? Math.round((causeReady - primaryReady) / MIN) : 0;
    const primaryEff = Math.round(Math.max(0, (primaryReady - leg.schedDep) / MIN));

    leg.actDep = actDep;
    leg.actArr = actDep + leg.blockMs;
    leg.delayMin = Math.round((leg.actArr - leg.schedArr) / MIN);
    leg.depDelayMin = Math.round(depDelay);
    leg.reactionaryDelayMin = reactionary;
    leg.primaryDelayMin = primaryEff;

    if (cause && reactionary >= 1) {
      leg.parentId = cause.id;
      leg.causeKind = causeKind;
      leg.rootId = cause.rootId || cause.id;
      leg.genome = [
        ...(cause.genome || []),
        {
          id: cause.id,
          callsign: cause.callsign,
          origin: cause.origin,
          dest: cause.dest,
          contributionMin: reactionary,
          kind: causeKind,
        },
      ];
    } else {
      leg.parentId = null;
      leg.causeKind = null;
      leg.genome = [];
      leg.rootId = primaryEff >= 5 ? leg.id : null;
    }
  }

  // Blast radius = how many legs carry this leg as an ancestor in their genome.
  const counts = new Map();
  for (const leg of legs) {
    for (const anc of leg.genome) counts.set(anc.id, (counts.get(anc.id) || 0) + 1);
  }
  for (const leg of legs) leg.blastRadius = counts.get(leg.id) || 0;

  return legs;
}
