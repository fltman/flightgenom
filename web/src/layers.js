import { IconLayer, ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { colorFor } from './colors.js';

const ICON_MAPPING = { plane: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true } };

// Which marked genome (if any) a flight belongs to: it carries the marker id in
// its genome, or it IS the marked flight. Returns the mark's rgb, 'dim' when
// marks are active but this flight is in none, or null when no marks.
function markOf(d, marks) {
  if (!marks || !marks.length) return null;
  for (const mk of marks) {
    if (d.id === mk.id || (d.genome && d.genome.some((g) => g.id === mk.id))) return mk.rgb;
  }
  return 'dim';
}

export function makeAircraftLayer({ data, icon, mode, selActive, memberSet, marks, onClick, onHover }) {
  return new IconLayer({
    id: 'aircraft',
    data,
    iconAtlas: icon,
    iconMapping: ICON_MAPPING,
    getIcon: () => 'plane',
    sizeUnits: 'pixels',
    sizeMinPixels: 9,
    getPosition: (d) => d.position,
    getAngle: (d) => -(d.track || 0),
    getSize: (d) => {
      const base = mode === 'genome' ? 18 + Math.min(14, (d.blastRadius || 0) * 2.5) : 19;
      const mk = markOf(d, marks);
      const markBoost = mk && mk !== 'dim' ? 7 : 0;
      const selBoost = selActive && memberSet && memberSet.has(d.id) ? 6 : 0;
      return base + Math.max(markBoost, selBoost);
    },
    getColor: (d) => {
      const mk = markOf(d, marks);
      if (mk === 'dim') return [120, 130, 145, 35];
      if (mk) return [mk[0], mk[1], mk[2], 255];
      const c = colorFor(d, mode);
      const dim = selActive && memberSet && !memberSet.has(d.id);
      return [c[0], c[1], c[2], dim ? 45 : 255];
    },
    pickable: true,
    onClick,
    onHover,
    updateTriggers: {
      getColor: [mode, selActive, marks, data],
      getSize: [mode, selActive, marks, data],
      getAngle: data,
    },
  });
}

const ARC = { ancestor: [255, 170, 40], self: [255, 255, 255], descendant: [235, 70, 55] };

export function makeArcLayer(arcs) {
  return new ArcLayer({
    id: 'cascade-arcs',
    data: arcs,
    getSourcePosition: (d) => d.source,
    getTargetPosition: (d) => d.target,
    getSourceColor: (d) => ARC[d.role],
    getTargetColor: (d) => ARC[d.role],
    getWidth: (d) => (d.role === 'self' ? 4 : 2.5),
    getHeight: 0.25,
    greatCircle: true,
    pickable: false,
  });
}

export function makeAirportLayer(points) {
  return new ScatterplotLayer({
    id: 'cascade-airports',
    data: points,
    getPosition: (d) => d.position,
    radiusUnits: 'pixels',
    getRadius: 4,
    stroked: true,
    getLineColor: [255, 210, 80, 220],
    getFillColor: [255, 210, 80, 90],
    lineWidthUnits: 'pixels',
    getLineWidth: 1.5,
    pickable: false,
  });
}

export function makeRingLayer(members) {
  return new ScatterplotLayer({
    id: 'cascade-rings',
    data: members,
    getPosition: (d) => d.position,
    radiusUnits: 'pixels',
    getRadius: 15,
    stroked: true,
    filled: false,
    getLineColor: [255, 255, 255, 210],
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
    pickable: false,
  });
}
