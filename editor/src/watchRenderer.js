// Renders confirmed watch/warning zones as colored polygons on the map.
// Deliberately simpler than annotationRenderer.js: a watch is always a
// closed zone (no "arrow" variant), colored by its own severity level
// (not an owning system's color), and has no vertex-handle reshaping in
// this first cut -- delete and redraw covers that for now. While a new
// zone is actively being drawn, its live preview is already covered by
// the shared drawingSession/draft path annotationRenderer.js renders
// (see editor/src/main.js) -- that path is agnostic to what the
// in-progress shape will become, so nothing here needs to duplicate it.

import { smoothClosedPath } from './smoothPath.js';
import { watchColor } from './constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function token(p) { return `${p.lon},${-p.lat}`; }

function closedPathD(points) {
  if (!points.length) return '';
  return `M${token(points[0])}` + points.slice(1).map((p) => `L${token(p)}`).join('') + 'Z';
}

export function createWatchRenderer(svg) {
  const layer = el('g', { id: 'watch-layer' });
  svg.append(layer);

  function render({ watches }) {
    layer.replaceChildren();
    if (!watches || !watches.length) return;

    for (const watch of watches) {
      if (watch.points.length < 3) continue; // nothing to close yet
      const color = watchColor(watch.level);
      const smoothed = smoothClosedPath(watch.points, 16);
      layer.append(el('path', {
        class: 'watch-zone-fill',
        d: closedPathD(smoothed),
        fill: hexToRgba(color, 0.28),
        stroke: color,
        'data-watch-id': watch.id,
        'data-system-id': watch.systemId,
      }));
    }
  }

  return { render };
}
