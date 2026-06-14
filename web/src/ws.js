// WebSocket client with auto-reconnect. Streams aircraft snapshots in and
// pushes the current map viewport out (the server only sends aircraft inside it).
export function connect({ onState, onStatus }) {
  let sock = null;
  let retry = 0;
  let lastBounds = null;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    sock = new WebSocket(`${proto}://${location.host}/ws`);
    sock.onopen = () => {
      retry = 0;
      onStatus('live');
      if (lastBounds) sendViewport(lastBounds);
    };
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') onState(m.aircraft);
    };
    sock.onclose = () => {
      onStatus('reconnecting…');
      retry++;
      setTimeout(open, Math.min(5000, 500 * retry));
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* noop */
      }
    };
  }

  function sendViewport(bounds) {
    lastBounds = bounds;
    if (sock && sock.readyState === 1) sock.send(JSON.stringify({ type: 'viewport', bounds }));
  }

  open();
  return { sendViewport };
}
