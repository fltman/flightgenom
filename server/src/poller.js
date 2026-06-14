// Polls the data source on an interval, optionally enriches with delay data,
// updates the shared state, and fires onUpdate() so the server can broadcast.
export function startPoller({ source, enrichment, state, cfg, onUpdate, replace }) {
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      let list = await source.fetchAircraft(cfg);
      if (enrichment) list = await enrichment.enrich(list, cfg);
      if (replace) state.replace(list);
      else state.merge(list);
      onUpdate();
    } catch (e) {
      console.error('[poller]', e.message);
    }
    if (!stopped) setTimeout(tick, cfg.pollIntervalMs);
  }

  tick();
  return () => {
    stopped = true;
  };
}
