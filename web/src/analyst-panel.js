// Renders the AI briefing: computed metric chips, the LLM narrative (summary,
// conclusions, sensitive points, predictions), and clickable computed lists
// (top propagators + expected next delays) that jump to a flight's cascade.
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const chip = (k, v) => `<div class="ai-chip"><div class="k">${k}</div><div class="v">${v}</div></div>`;
const section = (title, body) => (body ? `<div class="ai-sec-title">${title}</div>${body}` : '');
const list = (arr) =>
  arr && arr.length ? `<ul class="ai-list">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

export function renderLoading(el, model) {
  el.innerHTML = `<div class="ai-loading"><span class="spin"></span> Analyzing with ${esc(model)}…<div class="ai-loading-sub">reasoning models can take ~15-25s</div></div>`;
}

export function renderAnalysis(el, data, onPick) {
  const m = data.metrics || {};
  const s = m.summary || {};
  const ai = data.ai || {};
  let html = '';

  const num = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
  html +=
    `<div class="ai-chips">` +
    chip('Flights', s.totalFlights ?? '—') +
    chip('Delayed', s.delayedOver15 ?? '—') +
    chip('On-time', (s.onTimePct ?? '—') + '%') +
    chip('Pax hit', num(s.passengersDelayed)) +
    `</div>`;

  if (ai.available) {
    html += `<div class="ai-summary">${esc(ai.summary)}</div>`;
    html += section('Conclusions', list(ai.conclusions));
    html += section('Narrow sensitive points', list(ai.sensitivePoints));
    html += section('Predictions', list(ai.predictions));
  } else {
    html += `<div class="ai-note">${esc(ai.note || 'AI narrative unavailable — showing computed metrics.')}</div>`;
  }

  html += section(
    'Top propagators',
    (m.topPropagators || [])
      .map(
        (p) =>
          `<button class="ai-row" data-id="${esc(p.id)}"><span class="ai-cs">${esc(p.callsign)}</span> <em>${esc(
            p.route
          )}</em><span class="ai-r">+${p.delayMin}m · ${p.blastRadius}✈ · ${(p.passengersAffected || 0).toLocaleString()}p</span></button>`
      )
      .join('')
  );

  html += section(
    'Sensitive airports',
    (m.sensitiveAirports || [])
      .map(
        (a) =>
          `<div class="ai-apt"><span class="ai-cs">${esc(a.code)}</span> <em>${esc(
            a.name
          )}</em><span class="ai-r">reach ${a.propagationReach} · +${a.delaysOriginatedMin}m</span></div>`
      )
      .join('')
  );

  if ((m.upcomingAtRisk || []).length) {
    html += section(
      'Expected next delays',
      m.upcomingAtRisk
        .map(
          (u) =>
            `<button class="ai-row" data-id="${esc(u.id)}"><span class="ai-cs">${esc(u.callsign)}</span> <em>${esc(
              u.route
            )}</em><span class="ai-r">+${u.expectedDelayMin}m · in ${u.departsInMin}m</span></button>`
        )
        .join('')
    );
  }

  const when = new Date(data.generatedAt).toLocaleTimeString();
  html += `<div class="ai-foot">${esc(data.model)} · ${when}</div>`;

  el.innerHTML = html;
  el.querySelectorAll('.ai-row[data-id]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id)));
}
